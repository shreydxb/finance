-- SHR-113 Phase C: authoritative daily net-worth scheduler activation.
--
-- This is an explicit production activation artifact, not part of the portable
-- application-schema migration chain. Run it only after independent approval
-- and only after provisioning the three named Vault secrets documented in
-- supabase/scheduler/README.md. No secret value belongs in this file.

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $activation_preflight$
declare
  v_missing_names text[];
begin
  if current_user <> 'postgres' then
    raise exception 'Authoritative net-worth scheduler must be installed by postgres';
  end if;

  select array_agg(required.name order by required.name)
    into v_missing_names
  from (
    values
      ('shr113_snapshot_anon_jwt'),
      ('shr113_snapshot_endpoint'),
      ('shr113_snapshot_job_secret')
  ) as required(name)
  where not exists (
    select 1
    from vault.decrypted_secrets as secret
    where secret.name = required.name
      and nullif(btrim(secret.decrypted_secret), '') is not null
  );

  if coalesce(cardinality(v_missing_names), 0) > 0 then
    raise exception 'Missing required Vault secret names: %',
      array_to_string(v_missing_names, ', ');
  end if;
end;
$activation_preflight$;

create or replace function private.dispatch_authoritative_net_worth_snapshot()
returns bigint
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_endpoint text;
  v_anon_jwt text;
  v_job_secret text;
  v_target_day date :=
    ((clock_timestamp() at time zone 'Asia/Dubai')::date - 1);
begin
  select secret.decrypted_secret
    into v_endpoint
  from vault.decrypted_secrets as secret
  where secret.name = 'shr113_snapshot_endpoint';

  select secret.decrypted_secret
    into v_anon_jwt
  from vault.decrypted_secrets as secret
  where secret.name = 'shr113_snapshot_anon_jwt';

  select secret.decrypted_secret
    into v_job_secret
  from vault.decrypted_secrets as secret
  where secret.name = 'shr113_snapshot_job_secret';

  if nullif(btrim(v_endpoint), '') is null
    or nullif(btrim(v_anon_jwt), '') is null
    or nullif(btrim(v_job_secret), '') is null then
    raise exception 'Authoritative net-worth scheduler Vault configuration is incomplete';
  end if;

  return net.http_post(
    url := v_endpoint,
    body := jsonb_build_object(
      'trigger_kind', 'scheduled',
      'target_day', v_target_day::text
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_jwt,
      'apikey', v_anon_jwt,
      'x-snapshot-job-secret', v_job_secret
    ),
    timeout_milliseconds := 120000
  );
end;
$function$;

revoke all on function private.dispatch_authoritative_net_worth_snapshot()
  from public, anon, authenticated, service_role;

comment on function private.dispatch_authoritative_net_worth_snapshot() is
  'SHR-113 Phase C postgres-owned cron dispatcher. Reads Vault-held least-privilege JWT and operator secret, then enqueues one scheduled previous-Dubai-day Edge request. Not browser/service-role executable.';

select cron.schedule(
  'shr-113-authoritative-net-worth-close',
  '0 22 * * *',
  $command$select private.dispatch_authoritative_net_worth_snapshot();$command$
);

commit;
