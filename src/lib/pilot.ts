import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

export type PilotProgram={id:string;organization_id:string;establishment_id:string;name:string;hypothesis:string;success_definition:string;status:'active'|'completed'|'cancelled';started_on:string;target_end_on:string;baseline_window_days:number;activated_at:string;completed_at:string|null;cancelled_at:string|null;created_by:string;created_at:string;updated_at:string};
export type PilotMetric={value:number|null;unit:string;source:string;windowed:boolean};
export type PilotSnapshot={id:string;program_id:string;snapshot_type:'baseline'|'current'|'final';window_start_on:string;window_end_on:string;metrics:Record<string,PilotMetric>;limitations:string[];source_version:string;captured_by:string;captured_at:string};
export type PilotValueCategory='avoided_downtime'|'maintenance_saving'|'input_saving'|'yield_protection'|'labor_saving'|'other';
export type PilotValueClaim={id:string;program_id:string;category:PilotValueCategory;amount:number;currency:string;calculation_method:string;evidence_reference:string;status:'declared'|'internally_verified'|'rejected';claimed_by:string;reviewed_by:string|null;reviewed_at:string|null;review_note:string|null;created_at:string};
export type PilotControlData={programs:PilotProgram[];snapshots:PilotSnapshot[];claims:PilotValueClaim[]};

async function client(){if(!supabase)throw new Error('Supabase no está configurado');return supabase}
function invalidatePilot(queryClient:ReturnType<typeof useQueryClient>,establishmentId:string){return Promise.all([queryClient.invalidateQueries({queryKey:['pilot-control',establishmentId]}),queryClient.invalidateQueries({queryKey:['workspace']})])}

export function usePilotControl(establishmentId:string){
  return useQuery<PilotControlData>({
    queryKey:['pilot-control',establishmentId],staleTime:20_000,refetchInterval:60_000,
    queryFn:async()=>{
      const sdk=await client();
      const {data:programs,error:programError}=await sdk.from('pilot_programs').select('id,organization_id,establishment_id,name,hypothesis,success_definition,status,started_on,target_end_on,baseline_window_days,activated_at,completed_at,cancelled_at,created_by,created_at,updated_at').eq('establishment_id',establishmentId).order('created_at',{ascending:false});
      if(programError)throw programError;
      const typedPrograms=(programs??[]) as PilotProgram[];
      if(!typedPrograms.length)return {programs:[],snapshots:[],claims:[]};
      const ids=typedPrograms.map(program=>program.id);
      const [snapshotResult,claimResult]=await Promise.all([
        sdk.from('pilot_snapshots').select('id,program_id,snapshot_type,window_start_on,window_end_on,metrics,limitations,source_version,captured_by,captured_at').in('program_id',ids).order('captured_at',{ascending:false}),
        sdk.from('pilot_value_claims').select('id,program_id,category,amount,currency,calculation_method,evidence_reference,status,claimed_by,reviewed_by,reviewed_at,review_note,created_at').in('program_id',ids).order('created_at',{ascending:false}),
      ]);
      if(snapshotResult.error)throw snapshotResult.error;if(claimResult.error)throw claimResult.error;
      return {programs:typedPrograms,snapshots:(snapshotResult.data??[]) as PilotSnapshot[],claims:(claimResult.data??[]) as PilotValueClaim[]};
    },
  });
}

export function useLaunchPilot(establishmentId:string){
  const queryClient=useQueryClient();
  return useMutation({mutationFn:async(input:{name:string;hypothesis:string;successDefinition:string;targetEnd:string;baselineDays:number})=>{const sdk=await client();const {data,error}=await sdk.rpc('launch_pilot_program',{target_establishment:establishmentId,program_name:input.name.trim(),program_hypothesis:input.hypothesis.trim(),program_success_definition:input.successDefinition.trim(),target_end:input.targetEnd,baseline_days:input.baselineDays,request_id:crypto.randomUUID()});if(error)throw error;return String(data)},onSuccess:()=>invalidatePilot(queryClient,establishmentId)});
}
export function useCapturePilotSnapshot(establishmentId:string){
  const queryClient=useQueryClient();
  return useMutation({mutationFn:async(programId:string)=>{const sdk=await client();const {data,error}=await sdk.rpc('capture_pilot_snapshot',{target_program:programId,request_id:crypto.randomUUID()});if(error)throw error;return String(data)},onSuccess:()=>invalidatePilot(queryClient,establishmentId)});
}
export function useTransitionPilot(establishmentId:string){
  const queryClient=useQueryClient();
  return useMutation({mutationFn:async(input:{programId:string;status:'completed'|'cancelled';note:string})=>{const sdk=await client();const {error}=await sdk.rpc('transition_pilot_program',{target_program:input.programId,next_status:input.status,closing_note:input.note.trim(),request_id:crypto.randomUUID()});if(error)throw error},onSuccess:()=>invalidatePilot(queryClient,establishmentId)});
}
export function useRecordPilotValue(establishmentId:string){
  const queryClient=useQueryClient();
  return useMutation({mutationFn:async(input:{programId:string;category:PilotValueCategory;amount:number;calculationMethod:string;evidenceReference:string})=>{const sdk=await client();const {error}=await sdk.rpc('record_pilot_value_claim',{target_program:input.programId,value_category:input.category,value_amount:input.amount,value_calculation_method:input.calculationMethod.trim(),value_evidence_reference:input.evidenceReference.trim(),request_id:crypto.randomUUID()});if(error)throw error},onSuccess:()=>invalidatePilot(queryClient,establishmentId)});
}
export function useReviewPilotValue(establishmentId:string){
  const queryClient=useQueryClient();
  return useMutation({mutationFn:async(input:{claimId:string;accepted:boolean;note:string})=>{const sdk=await client();const {error}=await sdk.rpc('review_pilot_value_claim',{target_claim:input.claimId,accepted:input.accepted,reviewer_note:input.note.trim(),request_id:crypto.randomUUID()});if(error){if(error.message.includes('independent_reviewer_required'))throw new Error('La validación interna exige otra identidad administradora.');throw error}},onSuccess:()=>invalidatePilot(queryClient,establishmentId)});
}
