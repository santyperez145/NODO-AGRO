import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type { GeoJsonPolygon } from './geojson';

export type Establishment = { id: string; organization_id: string; name: string; latitude: number; longitude: number; area_hectares: number | null; base_currency:string; country_code:string; locale:string; timezone:string; unit_system:'metric'|'imperial' };
export type Parcel = { id: string; name: string; use: string; crop: string | null; area_hectares: number; health_score: number | null; boundary_geojson: unknown };
export type Device = { id: string; external_id: string; display_name: string; kind: string; status: string; last_seen_at: string | null; parcel_id: string|null; expected_interval_minutes: number; installed_at: string };
export type SensorReading = { id: number; device_id: string; observed_at: string; metric: string; value: number; unit: string; quality: number; ingested_at: string };
export type DeviceTwin = { device_id:string; desired_state:Record<string,unknown>; desired_version:number; desired_updated_at:string|null; reported_state:Record<string,unknown>; reported_version:number; reported_updated_at:string|null };
export type DeviceCommand = { id:string; device_id:string; command_type:'request_status'|'set_reporting_interval'|'restart_agent'; payload:Record<string,unknown>; status:'queued'|'delivered'|'succeeded'|'failed'|'expired'|'cancelled'; created_at:string; expires_at:string; delivered_at:string|null; acknowledged_at:string|null; delivery_attempts:number; result:Record<string,unknown>|null };
export type WeatherObservation = { observed_at: string; temperature_c: number; humidity_pct: number; precipitation_mm: number; wind_kmh: number; forecast_rain_7d_mm: number; source: string };
export type SatelliteScene = { id:string; external_id:string; captured_at: string; cloud_cover_pct: number | null; provider: string; collection: string; catalog_url: string | null };
export type SatelliteIndexName = 'ndvi'|'ndmi';
export type ParcelSatelliteMetric = { id:string; parcel_id:string; satellite_scene_id:string; analysis_run_id:string; index_name:SatelliteIndexName; captured_at:string; cloud_cover_pct:number|null; mean_value:number; min_value:number; max_value:number; stddev_value:number; percentile_02:number|null; percentile_98:number|null; valid_percent:number; pixel_count:number; quality_status:'usable'|'cloud_limited'|'insufficient_pixels'; source_provider:string; algorithm_version:string; computed_at:string };
export type SatelliteAnalysisRun = { id:string; satellite_scene_id:string; index_name:SatelliteIndexName; status:'running'|'completed'|'partial'|'failed'; parcel_count:number; succeeded_count:number; failed_count:number; error_code:string|null; started_at:string; completed_at:string|null };
export type Recommendation = { id: string; title: string; rationale: string; action: string; priority: 'critical'|'high'|'medium'|'low'; status: 'open'|'accepted'|'dismissed'|'completed'; confidence: number; evidence: unknown[]; valid_until: string | null; generated_at: string };
export type LivestockGroup = { id:string; parcel_id:string|null; name:string; species:'cattle'|'sheep'|'goat'|'horse'|'other'; category:string; head_count:number; average_weight_kg:number|null; status:'active'|'closed'; last_observed_at:string; notes:string|null };
export type LivestockEvent = { id:string; group_id:string; event_type:'initial_stock'|'birth'|'purchase'|'sale'|'mortality'|'transfer_in'|'transfer_out'|'adjustment'|'weighing'; occurred_at:string; head_delta:number; resulting_head_count:number; average_weight_kg:number|null; reason:string|null; created_at:string };
export type MachineAsset = { id:string; display_name:string; kind:'tractor'|'harvester'|'implement'|'vehicle'|'pump'|'generator'|'other'; manufacturer:string|null; model:string|null; serial_number:string|null; model_year:number|null; current_hours:number; service_interval_hours:number; last_service_hours:number; status:'active'|'maintenance'|'unavailable'|'retired'; updated_at:string };
export type MachineEvent = { id:string; machine_id:string; event_type:'usage'|'service'|'repair'|'inspection'; occurred_at:string; hours_delta:number; meter_hours:number; notes:string|null; created_at:string };
export type MaintenanceWorkOrder = { id:string; machine_id:string; work_type:'preventive'|'corrective'|'inspection'; title:string; description:string|null; priority:'low'|'medium'|'high'|'critical'; status:'open'|'scheduled'|'in_progress'|'blocked'|'completed'|'cancelled'; due_on:string|null; responsible:string|null; estimated_cost:number|null; actual_cost:number|null; currency:string; opened_at:string; started_at:string|null; completed_at:string|null; cancelled_at:string|null; completion_notes:string|null; lock_version:number; updated_at:string };
export type MaintenanceWorkOrderEvent = { id:number; work_order_id:string; action:'created'|'status_changed'; previous_status:MaintenanceWorkOrder['status']|null; next_status:MaintenanceWorkOrder['status']; details:Record<string,unknown>; created_at:string };
export type FinancialEntry = { id:string; parcel_id:string|null; machine_id:string|null; direction:'income'|'expense'; occurred_on:string; category:string; amount:number; currency:string; description:string; reference:string|null; reversal_of:string|null; created_at:string };
export type OperationalSummary = { establishment_id:string; organization_id:string; base_currency:string; livestock_heads:number; active_livestock_groups:number; active_machines:number; maintenance_due:number; month_income:number; month_expense:number; last_livestock_event_at:string|null; last_machine_event_at:string|null; last_financial_entry_at:string|null; open_work_orders:number; overdue_work_orders:number; month_maintenance_cost:number };
export type AiPriority = { domain:'crop'|'livestock'|'machinery'|'iot'|'weather'|'economy'; severity:'critical'|'high'|'medium'|'low'; title:string; rationale:string; action:string; confidence:number; evidence:string[]; economic_impact:string; requires_human_approval:boolean };
export type AiBriefResult = { summary:string; data_quality_score:number; priorities:AiPriority[]; opportunities:string[]; limitations:string[] };
export type AiAnalysisRun = { id:string; organization_id:string; establishment_id:string; analysis_type:'operational_brief'; question:string|null; prompt_version:string; result:AiBriefResult; created_at:string; completed_at:string; expires_at:string };

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
  satelliteMetrics: ParcelSatelliteMetric[];
  satelliteAnalysisRuns: SatelliteAnalysisRun[];
  recommendations: Recommendation[];
  livestockGroups: LivestockGroup[];
  livestockEvents: LivestockEvent[];
  machineAssets: MachineAsset[];
  machineEvents: MachineEvent[];
  maintenanceWorkOrders: MaintenanceWorkOrder[];
  maintenanceWorkOrderEvents: MaintenanceWorkOrderEvent[];
  financialEntries: FinancialEntry[];
  operationalSummary: OperationalSummary | null;
  latestAiAnalysis: AiAnalysisRun | null;
};

function emptyOperation() {
  return { parcels:[], devices:[], sensorReadings:[], deviceTwins:[], deviceCommands:[], weather:null, satellite:null, satelliteMetrics:[], satelliteAnalysisRuns:[], recommendations:[], livestockGroups:[], livestockEvents:[], machineAssets:[], machineEvents:[], maintenanceWorkOrders:[], maintenanceWorkOrderEvents:[], financialEntries:[], operationalSummary:null, latestAiAnalysis:null };
}

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
      if (!membership) return { organization:null, establishment:null, ...emptyOperation() };
      const organizationRecord = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
      const organization = { id: membership.organization_id, name: organizationRecord?.name ?? 'Organización', role: membership.role };
      const { data: establishments, error: establishmentError } = await client.from('establishments').select('*').eq('organization_id', organization.id).order('created_at').limit(1);
      if (establishmentError) throw establishmentError;
      const establishment = (establishments?.[0] as Establishment | undefined) ?? null;
      if (!establishment) return { organization, establishment:null, ...emptyOperation() };
      const [parcelsResult, devicesResult, readingsResult, twinsResult, commandsResult, weatherResult, satelliteResult, satelliteMetricsResult, satelliteRunsResult, recommendationsResult, livestockGroupsResult, livestockEventsResult, machineAssetsResult, machineEventsResult, workOrdersResult, workOrderEventsResult, financialEntriesResult, operationalSummaryResult, aiAnalysisResult] = await Promise.all([
        client.from('land_parcels').select('id,name,use,crop,area_hectares,health_score,boundary_geojson').eq('establishment_id', establishment.id).order('name'),
        client.from('devices').select('id,external_id,display_name,kind,status,last_seen_at,parcel_id,expected_interval_minutes,installed_at').eq('establishment_id', establishment.id).order('display_name'),
        client.from('latest_sensor_readings').select('id,device_id,observed_at,metric,value,unit,quality,ingested_at').eq('establishment_id', establishment.id).order('observed_at', { ascending: false }).limit(500),
        client.from('device_twins').select('device_id,desired_state,desired_version,desired_updated_at,reported_state,reported_version,reported_updated_at').eq('organization_id', organization.id),
        client.from('device_commands').select('id,device_id,command_type,payload,status,created_at,expires_at,delivered_at,acknowledged_at,delivery_attempts,result').eq('establishment_id', establishment.id).order('created_at', { ascending: false }).limit(100),
        client.from('weather_observations').select('observed_at,temperature_c,humidity_pct,precipitation_mm,wind_kmh,forecast_rain_7d_mm,source').eq('establishment_id', establishment.id).order('observed_at', { ascending: false }).limit(1).maybeSingle(),
        client.from('satellite_scenes').select('id,external_id,captured_at,cloud_cover_pct,provider,collection,catalog_url').eq('establishment_id', establishment.id).order('captured_at', { ascending: false }).limit(1).maybeSingle(),
        client.from('parcel_satellite_metrics').select('id,parcel_id,satellite_scene_id,analysis_run_id,index_name,captured_at,cloud_cover_pct,mean_value,min_value,max_value,stddev_value,percentile_02,percentile_98,valid_percent,pixel_count,quality_status,source_provider,algorithm_version,computed_at').eq('establishment_id', establishment.id).order('captured_at',{ascending:false}).limit(500),
        client.from('satellite_analysis_runs').select('id,satellite_scene_id,index_name,status,parcel_count,succeeded_count,failed_count,error_code,started_at,completed_at').eq('establishment_id', establishment.id).order('started_at',{ascending:false}).limit(20),
        client.from('recommendations').select('id,title,rationale,action,priority,status,confidence,evidence,valid_until,generated_at').eq('establishment_id', establishment.id).eq('status', 'open').order('generated_at', { ascending: false }).limit(8),
        client.from('livestock_groups').select('id,parcel_id,name,species,category,head_count,average_weight_kg,status,last_observed_at,notes').eq('establishment_id',establishment.id).order('status').order('name'),
        client.from('livestock_events').select('id,group_id,event_type,occurred_at,head_delta,resulting_head_count,average_weight_kg,reason,created_at').eq('establishment_id',establishment.id).order('occurred_at',{ascending:false}).limit(100),
        client.from('machine_assets').select('id,display_name,kind,manufacturer,model,serial_number,model_year,current_hours,service_interval_hours,last_service_hours,status,updated_at').eq('establishment_id',establishment.id).order('status').order('display_name'),
        client.from('machine_events').select('id,machine_id,event_type,occurred_at,hours_delta,meter_hours,notes,created_at').eq('establishment_id',establishment.id).order('occurred_at',{ascending:false}).limit(100),
        client.from('maintenance_work_orders').select('id,machine_id,work_type,title,description,priority,status,due_on,responsible,estimated_cost,actual_cost,currency,opened_at,started_at,completed_at,cancelled_at,completion_notes,lock_version,updated_at').eq('establishment_id',establishment.id).order('created_at',{ascending:false}).limit(200),
        client.from('maintenance_work_order_events').select('id,work_order_id,action,previous_status,next_status,details,created_at').eq('establishment_id',establishment.id).order('created_at',{ascending:false}).limit(300),
        client.from('financial_entries').select('id,parcel_id,machine_id,direction,occurred_on,category,amount,currency,description,reference,reversal_of,created_at').eq('establishment_id',establishment.id).order('occurred_on',{ascending:false}).order('created_at',{ascending:false}).limit(200),
        client.from('operational_summary').select('*').eq('establishment_id',establishment.id).maybeSingle(),
        client.from('latest_ai_analysis').select('id,organization_id,establishment_id,analysis_type,question,prompt_version,result,created_at,completed_at,expires_at').eq('establishment_id',establishment.id).maybeSingle(),
      ]);
      for (const result of [parcelsResult, devicesResult, readingsResult, twinsResult, commandsResult, weatherResult, satelliteResult, satelliteMetricsResult, satelliteRunsResult, recommendationsResult, livestockGroupsResult, livestockEventsResult, machineAssetsResult, machineEventsResult, workOrdersResult, workOrderEventsResult, financialEntriesResult, operationalSummaryResult, aiAnalysisResult]) if (result.error) throw result.error;
      return { organization, establishment, parcels:parcelsResult.data as Parcel[], devices:devicesResult.data as Device[], sensorReadings:readingsResult.data as SensorReading[], deviceTwins:twinsResult.data as DeviceTwin[], deviceCommands:commandsResult.data as DeviceCommand[], weather:weatherResult.data as WeatherObservation|null, satellite:satelliteResult.data as SatelliteScene|null, satelliteMetrics:satelliteMetricsResult.data as ParcelSatelliteMetric[], satelliteAnalysisRuns:satelliteRunsResult.data as SatelliteAnalysisRun[], recommendations:recommendationsResult.data as Recommendation[], livestockGroups:livestockGroupsResult.data as LivestockGroup[], livestockEvents:livestockEventsResult.data as LivestockEvent[], machineAssets:machineAssetsResult.data as MachineAsset[], machineEvents:machineEventsResult.data as MachineEvent[], maintenanceWorkOrders:workOrdersResult.data as MaintenanceWorkOrder[], maintenanceWorkOrderEvents:workOrderEventsResult.data as MaintenanceWorkOrderEvent[], financialEntries:financialEntriesResult.data as FinancialEntry[], operationalSummary:operationalSummaryResult.data as OperationalSummary|null, latestAiAnalysis:aiAnalysisResult.data as AiAnalysisRun|null };
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

const satelliteAnalysisResponseSchema=z.object({
  run_id:z.string().uuid(),status:z.enum(['completed','partial','failed']),index_name:z.enum(['ndvi','ndmi']),
  succeeded_count:z.number().int().nonnegative(),failed_count:z.number().int().nonnegative(),
  failures:z.array(z.object({parcel_id:z.string().uuid(),code:z.string()})),
  scene:z.object({id:z.string().uuid(),external_id:z.string(),captured_at:z.string(),cloud_cover_pct:z.number().nullable(),resolution_meters:z.number().positive()}),
  limitations:z.array(z.string()),
});

export function useComputeSatelliteAnalytics(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{establishmentId:string;indexName:SatelliteIndexName})=>{
      const client=await requireClient();
      const {data,error}=await client.functions.invoke('satellite-analytics',{body:{establishment_id:input.establishmentId,index_name:input.indexName}});
      if(error)throw new Error(await functionErrorMessage(error));
      if(data?.error)throw new Error(String(data.error));
      return satelliteAnalysisResponseSchema.parse(data);
    },
    onSuccess:()=>queryClient.invalidateQueries({queryKey:['workspace']}),
  });
}

const aiPrioritySchema=z.object({
  domain:z.enum(['crop','livestock','machinery','iot','weather','economy']),
  severity:z.enum(['critical','high','medium','low']),
  title:z.string().min(1).max(180),rationale:z.string().min(1).max(800),action:z.string().min(1).max(500),
  confidence:z.number().int().min(0).max(100),evidence:z.array(z.string().min(1).max(300)).max(5),
  economic_impact:z.string().min(1).max(300),requires_human_approval:z.boolean(),
});
const aiBriefSchema=z.object({summary:z.string().min(1).max(1200),data_quality_score:z.number().int().min(0).max(100),priorities:z.array(aiPrioritySchema).max(5),opportunities:z.array(z.string()).max(4),limitations:z.array(z.string()).max(6)});
const aiFunctionResponseSchema=z.object({run:z.object({id:z.string().uuid(),result:aiBriefSchema.optional(),completed_at:z.string().optional()}).passthrough(),cached:z.boolean()});

async function functionErrorMessage(error:unknown){
  if(error&&typeof error==='object'&&'context' in error&&(error as {context?:unknown}).context instanceof Response){
    try{const payload=await ((error as {context:Response}).context).clone().json() as {error?:unknown};if(typeof payload.error==='string')return payload.error}catch{/* malformed provider response */}
  }
  return error instanceof Error?error.message:'Error inesperado';
}

export function useGenerateAiBrief(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{establishmentId:string;question:string})=>{
      const client=await requireClient();
      const {data,error}=await client.functions.invoke('agro-intelligence',{body:{establishment_id:input.establishmentId,question:input.question.trim()||undefined}});
      if(error)throw new Error(await functionErrorMessage(error));
      if(data?.error)throw new Error(String(data.error));
      return aiFunctionResponseSchema.parse(data);
    },
    onSuccess:()=>queryClient.invalidateQueries({queryKey:['workspace']}),
  });
}

export function useAiFeedback(){
  return useMutation({mutationFn:async(input:{runId:string;rating:'useful'|'not_useful'})=>{
    const client=await requireClient();
    const {error}=await client.rpc('submit_ai_analysis_feedback',{target_run:input.runId,feedback_rating:input.rating,feedback_comment:null});
    if(error)throw error;
  }});
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

const entityIdSchema=z.string().uuid();

function invalidateWorkspace(queryClient:ReturnType<typeof useQueryClient>){return queryClient.invalidateQueries({queryKey:['workspace']})}

export function useCreateLivestockGroup(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{establishmentId:string;parcelId:string|null;name:string;species:LivestockGroup['species'];category:string;headCount:number;averageWeightKg:number|null;observedAt:string;notes:string})=>{
      const client=await requireClient();
      const {data,error}=await client.rpc('create_livestock_group',{target_establishment:input.establishmentId,target_parcel:input.parcelId,group_name:input.name.trim(),group_species:input.species,group_category:input.category.trim(),initial_head_count:input.headCount,initial_average_weight_kg:input.averageWeightKg,observed_at:input.observedAt,group_notes:input.notes,request_id:crypto.randomUUID()});
      if(error)throw error; return entityIdSchema.parse(data);
    },
    onSuccess:()=>invalidateWorkspace(queryClient),
  });
}

export function useRecordLivestockEvent(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{groupId:string;eventType:Exclude<LivestockEvent['event_type'],'initial_stock'>;occurredAt:string;headChange:number;averageWeightKg:number|null;reason:string})=>{
      const client=await requireClient();
      const {data,error}=await client.rpc('record_livestock_event',{target_group:input.groupId,event_name:input.eventType,occurred_at:input.occurredAt,head_change:input.headChange,measured_average_weight_kg:input.averageWeightKg,event_reason:input.reason,request_id:crypto.randomUUID()});
      if(error)throw error; return entityIdSchema.parse(data);
    },
    onSuccess:()=>invalidateWorkspace(queryClient),
  });
}

export function useCreateMachineAsset(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{establishmentId:string;name:string;kind:MachineAsset['kind'];manufacturer:string;model:string;serialNumber:string;modelYear:number|null;currentHours:number;serviceIntervalHours:number;lastServiceHours:number})=>{
      const client=await requireClient();
      const {data,error}=await client.rpc('create_machine_asset',{target_establishment:input.establishmentId,asset_name:input.name.trim(),asset_kind:input.kind,asset_manufacturer:input.manufacturer,asset_model:input.model,asset_serial_number:input.serialNumber,asset_model_year:input.modelYear,initial_hours:input.currentHours,maintenance_interval_hours:input.serviceIntervalHours,previous_service_hours:input.lastServiceHours});
      if(error)throw error; return entityIdSchema.parse(data);
    },
    onSuccess:()=>invalidateWorkspace(queryClient),
  });
}

export function useRecordMachineEvent(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{machineId:string;eventType:MachineEvent['event_type'];occurredAt:string;usageHours:number;notes:string})=>{
      const client=await requireClient();
      const {data,error}=await client.rpc('record_machine_event',{target_machine:input.machineId,event_name:input.eventType,occurred_at:input.occurredAt,usage_hours:input.usageHours,event_notes:input.notes,request_id:crypto.randomUUID()});
      if(error)throw error; return entityIdSchema.parse(data);
    },
    onSuccess:()=>invalidateWorkspace(queryClient),
  });
}

export function useCreateMachineWorkOrder(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{machineId:string;workType:MaintenanceWorkOrder['work_type'];title:string;description:string;priority:MaintenanceWorkOrder['priority'];dueOn:string|null;responsible:string;estimatedCost:number|null})=>{
      const client=await requireClient();
      const {data,error}=await client.rpc('create_machine_work_order',{
        target_machine:input.machineId,work_kind:input.workType,order_title:input.title.trim(),order_description:input.description.trim(),order_priority:input.priority,
        due_date:input.dueOn,responsible_label:input.responsible.trim(),expected_cost:input.estimatedCost,request_id:crypto.randomUUID(),
      });
      if(error)throw error; return entityIdSchema.parse(data);
    },
    onSuccess:()=>invalidateWorkspace(queryClient),
  });
}

export function useTransitionMachineWorkOrder(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{workOrderId:string;nextStatus:MaintenanceWorkOrder['status'];closingNote:string;finalCost:number|null})=>{
      const client=await requireClient();
      const {data,error}=await client.rpc('transition_machine_work_order',{
        target_order:input.workOrderId,next_state:input.nextStatus,closing_note:input.closingNote.trim(),final_cost:input.finalCost,request_id:crypto.randomUUID(),
      });
      if(error)throw error; return entityIdSchema.parse(data);
    },
    onSuccess:()=>invalidateWorkspace(queryClient),
  });
}

export function useRecordFinancialEntry(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{establishmentId:string;parcelId:string|null;machineId:string|null;direction:FinancialEntry['direction'];date:string;category:string;amount:number;currency:string;description:string;reference:string})=>{
      const client=await requireClient();
      const {data,error}=await client.rpc('record_financial_entry',{target_establishment:input.establishmentId,target_parcel:input.parcelId,target_machine:input.machineId,entry_direction:input.direction,entry_date:input.date,entry_category:input.category.trim(),entry_amount:input.amount,entry_currency:input.currency,entry_description:input.description.trim(),entry_reference:input.reference,request_id:crypto.randomUUID()});
      if(error)throw error; return entityIdSchema.parse(data);
    },
    onSuccess:()=>invalidateWorkspace(queryClient),
  });
}

export function useReverseFinancialEntry(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{entryId:string;reason:string})=>{
      const client=await requireClient();
      const {data,error}=await client.rpc('reverse_financial_entry',{target_entry:input.entryId,reversal_reason:input.reason.trim(),request_id:crypto.randomUUID()});
      if(error)throw error; return entityIdSchema.parse(data);
    },
    onSuccess:()=>invalidateWorkspace(queryClient),
  });
}
