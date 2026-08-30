begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select has_table('public','livestock_groups','livestock groups table exists');
select has_table('public','livestock_events','append-only livestock events table exists');
select has_table('public','machine_assets','machine assets table exists');
select has_table('public','machine_events','machine events table exists');
select has_table('public','financial_entries','financial ledger table exists');
select has_table('public','operational_audit_events','operational audit table exists');
select has_view('public','operational_summary','operational summary view exists');
select has_table('public','ai_analysis_runs','auditable intelligence run table exists');
select has_table('public','ai_analysis_feedback','intelligence feedback table exists');
select has_view('public','latest_ai_analysis','latest intelligence view exists');

select is((select relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname='livestock_groups'),true,'livestock groups has RLS enabled');
select is((select relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname='livestock_events'),true,'livestock events has RLS enabled');
select is((select relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname='machine_assets'),true,'machine assets has RLS enabled');
select is((select relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname='machine_events'),true,'machine events has RLS enabled');
select is((select relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname='financial_entries'),true,'financial entries has RLS enabled');
select is((select relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname='operational_audit_events'),true,'audit events has RLS enabled');
select is((select relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname='ai_analysis_runs'),true,'intelligence runs have RLS enabled');
select is((select relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname='ai_analysis_feedback'),true,'intelligence feedback has RLS enabled');

select is(has_table_privilege('authenticated','public.livestock_groups','INSERT'),false,'authenticated cannot bypass livestock RPC');
select is(has_table_privilege('authenticated','public.machine_assets','UPDATE'),false,'authenticated cannot directly alter machine state');
select is(has_table_privilege('authenticated','public.financial_entries','INSERT'),false,'authenticated cannot directly write the ledger');
select is(has_table_privilege('authenticated','public.financial_entries','DELETE'),false,'authenticated cannot delete ledger entries');
select is(has_table_privilege('authenticated','public.operational_audit_events','INSERT'),false,'authenticated cannot forge audit events');
select is(has_table_privilege('authenticated','public.ai_analysis_runs','INSERT'),false,'browser cannot forge intelligence runs');
select is(has_table_privilege('authenticated','public.ai_analysis_runs','UPDATE'),false,'browser cannot alter intelligence outputs');
select is(has_table_privilege('authenticated','public.ai_analysis_feedback','INSERT'),false,'feedback must pass through the guarded RPC');

select ok((select 'security_invoker=true'=any(coalesce(reloptions,array[]::text[])) from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname='operational_summary'),'operational summary runs with invoker security');
select ok((select 'security_invoker=true'=any(coalesce(reloptions,array[]::text[])) from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname='latest_ai_analysis'),'latest intelligence view runs with invoker security');
select ok(has_function_privilege('authenticated','public.submit_ai_analysis_feedback(uuid,ai_feedback_rating,text)','EXECUTE'),'authenticated role can call guarded intelligence feedback RPC');
select ok(has_function_privilege('authenticated','public.reverse_financial_entry(uuid,text,uuid)','EXECUTE'),'authenticated role can call guarded reversal RPC');

select * from finish();
rollback;
