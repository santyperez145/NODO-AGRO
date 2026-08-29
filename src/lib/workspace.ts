import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

export type Establishment = { id: string; organization_id: string; name: string; latitude: number; longitude: number; area_hectares: number | null };
export type Parcel = { id: string; name: string; use: string; crop: string | null; area_hectares: number; health_score: number | null };
export type Device = { id: string; external_id: string; kind: string; status: string; last_seen_at: string | null };
export type WeatherObservation = { observed_at: string; temperature_c: number; humidity_pct: number; precipitation_mm: number; wind_kmh: number; forecast_rain_7d_mm: number; source: string };
export type SatelliteScene = { captured_at: string; cloud_cover_pct: number | null; provider: string; collection: string; catalog_url: string | null };
export type Recommendation = { id: string; title: string; rationale: string; action: string; priority: 'critical'|'high'|'medium'|'low'; status: 'open'|'accepted'|'dismissed'|'completed'; confidence: number; evidence: unknown[]; valid_until: string | null; generated_at: string };

export type Workspace = {
  organization: { id: string; name: string; role: string } | null;
  establishment: Establishment | null;
  parcels: Parcel[];
  devices: Device[];
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
    queryFn: async () => {
      const client = await requireClient();
      const { data: membership, error: membershipError } = await client
        .from('organization_members').select('organization_id,role,organizations(id,name)').limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return { organization: null, establishment: null, parcels: [], devices: [], weather: null, satellite: null, recommendations: [] };
      const organizationRecord = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
      const organization = { id: membership.organization_id, name: organizationRecord?.name ?? 'Organización', role: membership.role };
      const { data: establishments, error: establishmentError } = await client.from('establishments').select('*').eq('organization_id', organization.id).order('created_at').limit(1);
      if (establishmentError) throw establishmentError;
      const establishment = (establishments?.[0] as Establishment | undefined) ?? null;
      if (!establishment) return { organization, establishment: null, parcels: [], devices: [], weather: null, satellite: null, recommendations: [] };
      const [parcelsResult, devicesResult, weatherResult, satelliteResult, recommendationsResult] = await Promise.all([
        client.from('land_parcels').select('id,name,use,crop,area_hectares,health_score').eq('establishment_id', establishment.id).order('name'),
        client.from('devices').select('id,external_id,kind,status,last_seen_at').eq('establishment_id', establishment.id).order('external_id'),
        client.from('weather_observations').select('observed_at,temperature_c,humidity_pct,precipitation_mm,wind_kmh,forecast_rain_7d_mm,source').eq('establishment_id', establishment.id).order('observed_at', { ascending: false }).limit(1).maybeSingle(),
        client.from('satellite_scenes').select('captured_at,cloud_cover_pct,provider,collection,catalog_url').eq('establishment_id', establishment.id).order('captured_at', { ascending: false }).limit(1).maybeSingle(),
        client.from('recommendations').select('id,title,rationale,action,priority,status,confidence,evidence,valid_until,generated_at').eq('establishment_id', establishment.id).eq('status', 'open').order('generated_at', { ascending: false }).limit(8),
      ]);
      for (const result of [parcelsResult, devicesResult, weatherResult, satelliteResult, recommendationsResult]) if (result.error) throw result.error;
      return { organization, establishment, parcels: parcelsResult.data as Parcel[], devices: devicesResult.data as Device[], weather: weatherResult.data as WeatherObservation | null, satellite: satelliteResult.data as SatelliteScene | null, recommendations: recommendationsResult.data as Recommendation[] };
    },
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
