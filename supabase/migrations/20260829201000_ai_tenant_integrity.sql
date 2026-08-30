alter table public.establishments
  add constraint establishments_id_organization_unique unique (id,organization_id);

alter table public.ai_analysis_runs
  add constraint ai_runs_id_organization_unique unique (id,organization_id),
  add constraint ai_runs_establishment_organization_fk
    foreign key (establishment_id,organization_id)
    references public.establishments(id,organization_id)
    on delete cascade;

alter table public.ai_analysis_feedback
  add constraint ai_feedback_run_organization_fk
    foreign key (run_id,organization_id)
    references public.ai_analysis_runs(id,organization_id)
    on delete cascade;

comment on constraint ai_runs_establishment_organization_fk on public.ai_analysis_runs is
  'Prevents a privileged server bug from associating an analysis with a different tenant.';
