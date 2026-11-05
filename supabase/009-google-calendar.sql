-- 05/11/2026 — sincronizzazione con Google Calendar (vedi supabase/functions/gcal-sync)
-- Prima di eseguire: sostituire __REF__ con il ref del progetto e __SECRET__ con il segreto scelto (= GCAL_HOOK_SECRET).
alter table cc_registrazioni add column if not exists google_event_id text;
alter table cc_registrazioni add column if not exists google_sync_at timestamptz;
create index if not exists cc_registrazioni_gcal_idx on cc_registrazioni(google_event_id);
create table if not exists cc_sync_state (k text primary key, v text);
alter table cc_sync_state enable row level security;   -- nessuna policy: ci accede solo la funzione con la chiave di servizio

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- portale → Google: a ogni appuntamento inserito/modificato/cancellato chiamo la funzione
drop trigger if exists cc_gcal_push_ins_upd on cc_registrazioni;
create trigger cc_gcal_push_ins_upd after insert or update on cc_registrazioni
  for each row when (new.tipo_codice like 'app_%' or new.google_event_id is not null)
  execute function supabase_functions.http_request('https://__REF__.supabase.co/functions/v1/gcal-sync','POST','{"Content-Type":"application/json","x-hook-secret":"__SECRET__"}','{}','5000');
drop trigger if exists cc_gcal_push_del on cc_registrazioni;
create trigger cc_gcal_push_del after delete on cc_registrazioni
  for each row when (old.google_event_id is not null)
  execute function supabase_functions.http_request('https://__REF__.supabase.co/functions/v1/gcal-sync','POST','{"Content-Type":"application/json","x-hook-secret":"__SECRET__"}','{}','5000');

-- Google → portale: ogni 2 minuti
select cron.unschedule('gcal-pull') where exists (select 1 from cron.job where jobname='gcal-pull');
select cron.schedule('gcal-pull','*/2 * * * *',
  $$ select net.http_post(url:='https://__REF__.supabase.co/functions/v1/gcal-sync?mode=pull',
       headers:='{"Content-Type":"application/json","x-hook-secret":"__SECRET__"}'::jsonb, body:='{}'::jsonb) $$);
