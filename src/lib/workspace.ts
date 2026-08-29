import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type { GeoJsonPolygon } from './geojson';

export type Establishment = { id: string; organization_id: string; name: string; latitude: number; longitude: number; area_hectares: number | null };
export type Parcel = { id: string; name: string; use: string; crop: string | null; area_hectares: number; health_score: number | null; boundary_geojson: unknown };
export type Device = { id: string; external_id: string; display_name: string; kind: string; status: string; last_seen_at: string | null; parcel_id: string|null; expected_interval_minutes: number; installed_at: string };
export type SensorReading = { id: number; device_id: string; observed_at: string; metric: string; value: number; unit: string; quality: number; ingested_at: string };
export type DeviceTwin = { device_id:string; desired_state:Record<string,unknown>; desired_version:number; desired_updated_at:string|null; reported_state:Record<string,unknown>; reported_version:number; reported_updated_at:string|null };
export type DeviceCommand = { id:string; device_id:string; command_type:'request_status'|'set_reporting_interval'|'restart_agent'; payload:Record<string,unknown>; status:'queued'|'delivered'|'succeeded'|'failed'|'expired'|'cancelled'; created_at:string; expires_at:string; delivered_at:string|null; acknowledged_at:string|null; delivery_attempts:number; result:Record<string,unknown>|null };
export type WeatherObservation = { observed_at: string; temperature_c: number; humidity_pct: number; precipitation_mm: number; wind_kmh: number; forecast_rain_7d_mm: number; source: string };
export type SatelliteScene = { captured_at: string; cloud_cover_pct: number | null; provider: string; collection: string; catalog_url: string | null };
export type Recommendation = { id: string; title: string; rationale: string; action: string; priority: 'critical'|'high'|'medium'|'low'; status: 'open'|'accepted'|'dismissed'|'completed'; confidence: number; evidence: unknown[]; valid_until: string | null; generated_at: string };

export type Workspace = {
  organization: { id: string; name: string; role: string } | null;
  establishment: Establishment | null;
  parcels: Parcel[];
  devices: Device[];
  sensorReadings: SensorReading[];
  deviceTwins: DeviceTwin[];
  deviceCommands: DeviceCommand[];
  weather: WeatherObservation | null;
  satellite: SatelliteScene | null;
  recommendations: Recommendation[];
};

async function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
}

export function useWorkspace() {
  return useQuery<Workspace>({
    queryKey: ['workspace'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const client = await requireClient();
      const { data: membership, error: membershipError } = await client
        .from('organization_members').select('organization_id,role,organizations(id,name)').limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return { organization: null, establishment: null, parcels: [], devices: [], sensorReadings: [], deviceTwins: [], deviceCommands: [], weather: null, satellite: null, recommendations: [] };
      const organizationRecord = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
      const organization = { id: membership.organization_id, name: organizationRecord?.name ?? 'Organización', role: membership.role };
      const { data: establishments, error: establishmentError } = await client.from('establishments').select('*').eq('organization_id', organization.id).order('created_at').limit(1);
      if (establishmentError) throw establishmentError;
      const establishment = (establishments?.[0] as Establishment | undefined) ?? null;
      if (!establishment) return { organization, establishment: null, parcels: [], devices: [], sensorReadings: [], deviceTwins: [], deviceCommands: [], weather: null, satellite: null, recommendations: [] };
      const [parcelsResult, devicesResult, readingsResult, twinsResult, commandsResult, weatherResult, satelliteResult, recommendationsResult] = await Promise.all([
        client.from('land_parcels').select('id,name,use,crop,area_hectares,health_score,boundary_geojson').eq('establishment_id', establishment.id).order('name'),
        client.from('devices').select('id,external_id,display_name,kind,status,last_seen_at,parcel_id,expected_interval_minutes,installed_at').eq('establishment_id', establishment.id).order('display_name'),
        client.from('latest_sensor_readings').select('id,device_id,observed_at,metric,value,unit,quality,ingested_at').eq('establishment_id', establishment.id).order('observed_at', { ascending: false }).limit(500),
        client.from('device_twins').select('device_id,desired_state,desired_version,desired_updated_at,reported_state,reported_version,reported_updated_at').eq('organization_id', organization.id),
        client.from('device_commands').select('id,device_id,command_type,payload,status,created_at,expires_at,delivered_at,acknowledged_at,delivery_attempts,result').eq('establishment_id', establishment.id).order('created_at', { ascending: false }).limit(100),
        client.from('weather_observations').select('observed_at,temperature_c,humidity_pct,precipitation_mm,wind_kmh,forecast_rain_7d_mm,source').eq('establishment_id', establishment.id).order('observed_at', { ascending: false }).limit(1).maybeSingle(),
        client.from('satellite_scenes').select('captured_at,cloud_cover_pct,provider,collection,catalog_url').eq('establishment_id', establishment.id).order('captured_at', { ascending: false }).limit(1).maybeSingle(),
        client.from('recommendations').select('id,title,rationale,action,priority,status,confidence,evidence,valid_until,generated_at').eq('establishment_id', establishment.id).eq('status', 'open').order('generated_at', { ascending: false }).limit(8),
      ]);
      for (const result of [parcelsResult, devicesResult, readingsResult, twinsResult, commandsResult, weatherResult, satelliteResult, recommendationsResult]) if (result.error) throw result.error;
      return { organization, establishment, parcels: parcelsResult.data as Parcel[], devices: devicesResult.data as Device[], sensorReadings: readingsResult.data as SensorReading[], deviceTwins: twinsResult.data as DeviceTwin[], deviceCommands: commandsResult.data as DeviceCommand[], weather: weatherResult.data as WeatherObservation | null, satellite: satelliteResult.data as SatelliteScene | null, recommendations: recommendationsResult.data as Recommendation[] };
    },
  });
}

export type DeviceConnectionState = 'online'|'offline'|'provisioning'|'retired';

export function deviceConnectionState(device:Device,now=Date.now()):DeviceConnectionState {
  if(device.status==='retired') return 'retired';
  if(!device.last_seen_at) return 'provisioning';
  const lastSeen=Date.parse(device.last_seen_at);
  if(!Number.isFinite(lastSeen)) return 'offline';
  const toleranceMinutes=Math.max(15,device.expected_interval_minutes*2.5);
  return now-lastSeen<=toleranceMinutes*60_000?'online':'offline';
}

const provisionedDeviceSchema=z.object({device_id:z.string().uuid(),token:z.string().min(32)});

export function useProvisionDevice() {
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{establishmentId:string;externalId:string;kind:string;displayName:string;parcelId:string|null;intervalMinutes:number})=>{
      const client=await requireClient();
      const {data,error}=await client.rpc('provision_device',{
        target_establishment:input.establishmentId,
        device_external_id:input.externalId.trim(),
        device_kind:input.kind,
        device_display_name:input.displayName.trim(),
        target_parcel:input.parcelId,
        reporting_interval_minutes:input.intervalMinutes,
      });
      if(error) throw error;
      return provisionedDeviceSchema.parse(data);
    },
    onSuccess:()=>queryClient.invalidateQueries({queryKey:['workspace']}),
  });
}

const commandIdSchema=z.string().uuid();

export function useQueueDeviceCommand() {
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{deviceId:string;commandType:DeviceCommand['command_type'];payload:Record<string,unknown>;ttlSeconds?:number})=>{
      const client=await requireClient();
      const {data,error}=await client.rpc('queue_device_command',{
        target_device:input.deviceId,
        command_name:input.commandType,
        command_payload:input.payload,
        command_idempotency_key:crypto.randomUUID(),
        ttl_seconds:input.ttlSeconds??900,
      });
      if(error) throw error;
      return commandIdSchema.parse(data);
    },
    onSuccess:()=>queryClient.invalidateQueries({queryKey:['workspace']}),
  });
}

export function useBootstrap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { organizationName: string; establishmentName: string; latitude: number; longitude: number; areaHectares: number }) => {
      const client = await requireClient();
      const { data, error } = await client.rpc('bootstrap_establishment', {
        organization_name: input.organizationName, establishment_name: input.establishmentName,
        establishment_latitude: input.latitude, establishment_longitude: input.longitude,
        establishment_area_hectares: input.areaHectares,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace'] }),
  });
}

export function useSyncIntelligence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (establishmentId: string) => {
      const client = await requireClient();
      const { data, error } = await client.functions.invoke('sync-intelligence', { body: { establishment_id: establishmentId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace'] }),
  });
}

export function useRecommendationAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'accepted'|'dismissed'|'completed' }) => {
      const client = await requireClient();
      const { error } = await client.rpc('set_recommendation_status', { target_id: id, next_status: status, note: null });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace'] }),
  });
}

export function useCreateParcel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { organizationId:string; establishmentId:string; name:string; use:string; crop:string|null; areaHectares:number; boundary:GeoJsonPolygon }) => {
      const client = await requireClient();
      const { error } = await client.from('land_parcels').insert({
        organization_id:input.organizationId, establishment_id:input.establishmentId,
        name:input.name.trim(), use:input.use, crop:input.crop?.trim()||null,
        area_hectares:input.areaHectares, boundary_geojson:input.boundary,
      }).select('id').single();
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey:['workspace'] }),
  });
}

export function useUpdateParcel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id:string; organizationId:string; establishmentId:string; name:string; use:string; crop:string|null; areaHectares:number; boundary:GeoJsonPolygon }) => {
      const client = await requireClient();
      const { error } = await client.from('land_parcels').update({
        name:input.name.trim(), use:input.use, crop:input.crop?.trim()||null,
        area_hectares:input.areaHectares, boundary_geojson:input.boundary,
      }).eq('id',input.id).eq('organization_id',input.organizationId).eq('establishment_id',input.establishmentId).select('id').single();
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey:['workspace'] }),
  });
}
