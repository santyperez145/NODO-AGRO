import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const allowedRoles = new Set(['owner', 'admin', 'agronomist', 'operator']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const archiveUrl = 'https://archive-api.open-meteo.com/v1/archive';
const forecastUrl = 'https://api.open-meteo.com/v1/forecast';
const algorithmVersion = 'reference-et0-v1';
const observedDays = 30;
const forecastDays = 7;
const stuckRunMinutes = 8;
const ndmiAlgorithm = 'sentinel2-l2a-ndmi-scl-v1';

type WaterRequest = { establishment_id?: unknown };
type RunContext = { admin: SupabaseClient; runId: string };

class PublicError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(base: Date, days: number) {
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

type DailySeries = { observed_on: string; precipitation_mm: number; et0_mm: number; observation_kind: 'observed' | 'forecast' };

async function fetchDaily(url: string, params: URLSearchParams) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${url}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new PublicError(502, 'weather_provider_error', 'El archivo climático no respondió con un contrato válido.');
    const payload = await response.json() as { daily?: { time?: unknown; precipitation_sum?: unknown; et0_fao_evapotranspiration?: unknown } };
    const days = payload.daily?.time;
    const rain = payload.daily?.precipitation_sum;
    const et0 = payload.daily?.et0_fao_evapotranspiration;
    if (!Array.isArray(days) || !Array.isArray(rain) || !Array.isArray(et0) || days.length !== rain.length || days.length !== et0.length) {
      throw new PublicError(502, 'weather_contract_invalid', 'Open-Meteo no devolvió lluvia y ET0 alineados.');
    }
    const records: Array<{ observed_on: string; precipitation_mm: number; et0_mm: number }> = [];
    for (let index = 0; index < days.length; index += 1) {
      const day = days[index];
      const precipitation = finiteNumber(rain[index]);
      const reference = finiteNumber(et0[index]);
      if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || precipitation === null || reference === null || precipitation < 0 || reference < 0) continue;
      records.push({ observed_on: day, precipitation_mm: precipitation, et0_mm: reference });
    }
    return records;
  } finally {
    clearTimeout(timeout);
  }
}

async function persistClimate(
  admin: SupabaseClient,
  establishment: { id: string; organization_id: string; latitude: number; longitude: number },
) {
  const today = new Date();
  const yesterday = addUtcDays(today, -1);
  const archiveStart = addUtcDays(yesterday, -(observedDays - 1));
  const observed = await fetchDaily(archiveUrl, new URLSearchParams({
    latitude: String(establishment.latitude), longitude: String(establishment.longitude),
    start_date: isoDate(archiveStart), end_date: isoDate(yesterday),
    daily: 'precipitation_sum,et0_fao_evapotranspiration', timezone: 'UTC',
  }));
  const forecast = await fetchDaily(forecastUrl, new URLSearchParams({
    latitude: String(establishment.latitude), longitude: String(establishment.longitude),
    daily: 'precipitation_sum,et0_fao_evapotranspiration', timezone: 'UTC', forecast_days: String(forecastDays),
  }));
  const rows: Array<DailySeries & { organization_id: string; establishment_id: string; source: string }> = [
    ...observed.map(item => ({ ...item, organization_id: establishment.organization_id, establishment_id: establishment.id, source: 'Open-Meteo Archive', observation_kind: 'observed' as const })),
    ...forecast.filter(item => item.observed_on > isoDate(yesterday)).map(item => ({
      ...item, organization_id: establishment.organization_id, establishment_id: establishment.id,
      source: 'Open-Meteo Forecast', observation_kind: 'forecast' as const,
    })),
  ];
  if (!rows.length) throw new PublicError(409, 'climate_required', 'No hay una serie de lluvia y ET0 para armar el saldo.');
  const { error } = await admin.from('weather_daily_observations').upsert(rows, { onConflict: 'establishment_id,observed_on,source' });
  if (error) throw error;
  return rows;
}

function coverageStatus(input: { irrigation: number; soil: boolean; ndmi: boolean }) {
  if (input.irrigation > 0 && input.soil && input.ndmi) return 'instrumented' as const;
  if (input.ndmi) return 'with_canopy' as const;
  if (input.soil) return 'with_soil' as const;
  if (input.irrigation > 0) return 'with_irrigation' as const;
  return 'reference_only' as const;
}

function reviewStatus(input: {
  weatherDays: number; ndmiDelta: number | null; ndmiLatest: number | null;
  balance: number; recentIrrigation: boolean;
}) {
  if (input.weatherDays < 7 || input.ndmiLatest === null) return 'insufficient' as const;
  if (input.ndmiDelta !== null && input.ndmiDelta < 0 && input.balance < 0 && !input.recentIrrigation) return 'verify' as const;
  return 'watch' as const;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed', code: 'method_not_allowed' }, 405);

  let runContext: RunContext | null = null;
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new PublicError(401, 'authentication_required', 'Necesitás iniciar sesión.');
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) throw new Error('runtime_configuration_incomplete');

    let body: WaterRequest;
    try { body = await request.json() as WaterRequest; }
    catch { throw new PublicError(400, 'invalid_json', 'La solicitud no contiene JSON válido.'); }
    if (typeof body.establishment_id !== 'string' || !uuidPattern.test(body.establishment_id)) {
      throw new PublicError(400, 'invalid_establishment', 'El establecimiento no es válido.');
    }

    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) throw new PublicError(401, 'invalid_session', 'La sesión ya no es válida.');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: establishment, error: establishmentError } = await admin.from('establishments')
      .select('id,organization_id,latitude,longitude').eq('id', body.establishment_id).maybeSingle();
    if (establishmentError) throw establishmentError;
    if (!establishment) throw new PublicError(404, 'establishment_not_found', 'No encontramos el establecimiento.');
    const { data: membership, error: membershipError } = await admin.from('organization_members')
      .select('role').eq('organization_id', establishment.organization_id).eq('user_id', userData.user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !allowedRoles.has(membership.role)) throw new PublicError(403, 'forbidden', 'Tu rol no puede calcular el saldo hídrico.');

    const stuckBefore = new Date(Date.now() - stuckRunMinutes * 60_000).toISOString();
    await admin.from('water_balance_runs').update({
      status: 'failed', error_code: 'run_timeout', completed_at: new Date().toISOString(),
    }).eq('establishment_id', establishment.id).eq('status', 'running').lt('started_at', stuckBefore);

    const { data: activeRun, error: activeError } = await admin.from('water_balance_runs')
      .select('id').eq('establishment_id', establishment.id).eq('status', 'running').maybeSingle();
    if (activeError) throw activeError;
    if (activeRun) throw new PublicError(409, 'balance_in_progress', 'Ya hay un saldo hídrico en curso para este establecimiento.');

    const { data: parcels, error: parcelsError } = await admin.from('land_parcels')
      .select('id,name').eq('establishment_id', establishment.id).order('name').limit(101);
    if (parcelsError) throw parcelsError;
    if (!parcels?.length) throw new PublicError(409, 'parcels_required', 'Registrá al menos un lote antes de calcular el saldo hídrico.');
    if (parcels.length > 100) throw new PublicError(409, 'parcel_limit_exceeded', 'El saldo admite hasta 100 lotes.');

    const climate = await persistClimate(admin, establishment);
    const observedClimate = climate.filter(item => item.observation_kind === 'observed');
    const windowStart = observedClimate[0]?.observed_on ?? climate[0].observed_on;
    const windowEnd = observedClimate.at(-1)?.observed_on ?? climate.at(-1)!.observed_on;

    const { data: run, error: runError } = await admin.from('water_balance_runs').insert({
      organization_id: establishment.organization_id, establishment_id: establishment.id,
      algorithm_version: algorithmVersion, requested_by: userData.user.id,
      window_start: windowStart, window_end: windowEnd, parcel_count: parcels.length,
      weather_days: observedClimate.length,
    }).select('id').single();
    if (runError || !run) throw runError ?? new Error('water_run_not_created');
    runContext = { admin, runId: run.id };

    const [{ data: irrigations, error: irrigationError }, { data: ndmiMetrics, error: ndmiError }, { data: baselines, error: baselineError }, { data: devices, error: deviceError }, { data: readings, error: readingError }] = await Promise.all([
      admin.from('irrigation_events').select('id,parcel_id,applied_on,depth_mm,reversal_of').eq('establishment_id', establishment.id).gte('applied_on', windowStart).lte('applied_on', windowEnd),
      admin.from('parcel_satellite_metrics').select('parcel_id,mean_value,captured_at,quality_status').eq('establishment_id', establishment.id).eq('index_name', 'ndmi').eq('algorithm_version', ndmiAlgorithm).eq('quality_status', 'usable').order('captured_at', { ascending: false }).limit(400),
      admin.from('parcel_index_baselines').select('parcel_id,latest_delta').eq('establishment_id', establishment.id).eq('index_name', 'ndmi').eq('algorithm_version', ndmiAlgorithm),
      admin.from('devices').select('id,parcel_id').eq('establishment_id', establishment.id),
      admin.from('latest_sensor_readings').select('device_id,observed_at,metric,value,unit').eq('establishment_id', establishment.id).eq('metric', 'soil.moisture'),
    ]);
    if (irrigationError || ndmiError || baselineError || deviceError || readingError) {
      throw irrigationError ?? ndmiError ?? baselineError ?? deviceError ?? readingError;
    }

    const reversed = new Set((irrigations ?? []).filter(item => item.reversal_of).map(item => item.reversal_of as string));
    const activeIrrigation = (irrigations ?? []).filter(item => !item.reversal_of && !reversed.has(item.id));
    const rainMm = observedClimate.reduce((sum, item) => sum + item.precipitation_mm, 0);
    const et0Mm = observedClimate.reduce((sum, item) => sum + item.et0_mm, 0);
    const recentCutoff = isoDate(addUtcDays(new Date(), -7));
    const deviceParcel = new Map((devices ?? []).filter(item => item.parcel_id).map(item => [item.id, item.parcel_id as string]));
    const soilByParcel = new Map<string, { value: number; observed_at: string }>();
    for (const reading of readings ?? []) {
      const parcelId = deviceParcel.get(reading.device_id);
      const value = finiteNumber(reading.value);
      if (!parcelId || value === null || reading.unit !== 'pct') continue;
      const current = soilByParcel.get(parcelId);
      if (!current || reading.observed_at > current.observed_at) soilByParcel.set(parcelId, { value, observed_at: reading.observed_at });
    }
    const latestNdmi = new Map<string, { mean: number; captured_at: string }>();
    for (const metric of ndmiMetrics ?? []) {
      if (!latestNdmi.has(metric.parcel_id)) latestNdmi.set(metric.parcel_id, { mean: metric.mean_value, captured_at: metric.captured_at });
    }
    const ndmiDelta = new Map((baselines ?? []).map(item => [item.parcel_id, item.latest_delta]));

    const records = parcels.map(parcel => {
      const irrigationMm = activeIrrigation.filter(item => item.parcel_id === parcel.id).reduce((sum, item) => sum + Number(item.depth_mm), 0);
      const recentIrrigation = activeIrrigation.some(item => item.parcel_id === parcel.id && item.applied_on >= recentCutoff);
      const ndmi = latestNdmi.get(parcel.id) ?? null;
      const delta = ndmiDelta.get(parcel.id) ?? null;
      const soil = soilByParcel.get(parcel.id) ?? null;
      const balance = rainMm + irrigationMm - et0Mm;
      const limitations = [
        'ET0 es evapotranspiración de referencia FAO-56, no consumo de cultivo.',
        'El saldo no incluye escorrentía, percolación ni capacidad de campo.',
        ...(irrigationMm === 0 ? ['No hay riego declarado en la ventana; un lote de secano no es un faltante.'] : []),
        ...(soil ? [] : ['Sin humedad de suelo calibrada para este lote.']),
        ...(ndmi ? [] : ['Sin NDMI usable SCL en la ventana.']),
      ];
      return {
        organization_id: establishment.organization_id, establishment_id: establishment.id, parcel_id: parcel.id,
        run_id: run.id, algorithm_version: algorithmVersion, window_start: windowStart, window_end: windowEnd,
        rain_mm: rainMm, et0_mm: et0Mm, irrigation_mm: irrigationMm, reference_balance_mm: balance,
        weather_days: observedClimate.length,
        ndmi_latest: ndmi?.mean ?? null, ndmi_delta: delta, ndmi_captured_at: ndmi?.captured_at ?? null,
        soil_moisture_pct: soil?.value ?? null, soil_observed_at: soil?.observed_at ?? null,
        coverage_status: coverageStatus({ irrigation: irrigationMm, soil: Boolean(soil), ndmi: Boolean(ndmi) }),
        review_status: reviewStatus({
          weatherDays: observedClimate.length, ndmiDelta: delta, ndmiLatest: ndmi?.mean ?? null,
          balance, recentIrrigation,
        }),
        limitations, computed_at: new Date().toISOString(),
      };
    });

    const { error: upsertError } = await admin.from('parcel_water_balances').upsert(records, {
      onConflict: 'parcel_id,window_start,window_end,algorithm_version',
    });
    if (upsertError) throw upsertError;

    const { error: completionError } = await admin.from('water_balance_runs').update({
      status: 'completed', succeeded_count: records.length, failed_count: 0, completed_at: new Date().toISOString(),
    }).eq('id', run.id).eq('status', 'running');
    if (completionError) throw completionError;
    runContext = null;

    return json({
      run_id: run.id, status: 'completed', algorithm_version: algorithmVersion,
      window: { start: windowStart, end: windowEnd },
      weather_days: observedClimate.length, forecast_days: climate.length - observedClimate.length,
      parcel_count: records.length,
      rain_mm: rainMm, et0_mm: et0Mm,
      verify_count: records.filter(item => item.review_status === 'verify').length,
      limitations: [
        'El saldo es lluvia + riego declarado − ET0 de referencia FAO-56.',
        'No prescribe una lámina, no controla bombas y no afirma ahorro de agua.',
        'NDMI y humedad de suelo se usan como evidencia, no como diagnóstico.',
      ],
    });
  } catch (error) {
    if (runContext) {
      await runContext.admin.from('water_balance_runs').update({
        status: 'failed', succeeded_count: 0, failed_count: 0,
        error_code: error instanceof PublicError ? error.code : 'balance_failed', completed_at: new Date().toISOString(),
      }).eq('id', runContext.runId).eq('status', 'running');
    }
    const publicError = error instanceof PublicError ? error : new PublicError(500, 'balance_failed', 'No pudimos completar el saldo hídrico. Los registros anteriores siguen intactos.');
    console.error(JSON.stringify({ event: 'water_balance_failed', code: publicError.code, message: error instanceof Error ? error.message : String(error) }));
    return json({ error: publicError.message, code: publicError.code }, publicError.status);
  }
});
