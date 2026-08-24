-- SHR-113 Phase C immediate, non-destructive scheduler rollback.
-- This stops future dispatches but preserves the job row, cron run evidence,
-- all snapshot run/attempt/item evidence, and every nw_daily row.

begin;

do $disable_scheduler$
declare
  v_job_id bigint;
begin
  select job.jobid
    into v_job_id
  from cron.job as job
  where job.jobname = 'shr-113-authoritative-net-worth-close';

  if v_job_id is not null then
    perform cron.alter_job(job_id := v_job_id, active := false);
  end if;
end;
$disable_scheduler$;

commit;
