-- 05/11/2026 — sincronizzazione con Google Calendar (vedi supabase/functions/gcal-sync)
-- Prima di eseguire: sostituire __REF__ (ref progetto), __ANON__ (chiave anon) e __SECRET__ (= GCAL_HOOK_SECRET).
alter table cc_registrazioni add column if not exists google_event_id text;
alter table cc_registrazioni add column if not exists google_sync_at timestamptz;
create index if not exists cc_registrazioni_gcal_idx on cc_registrazioni(google_event_id);

-- Configurazione e stato della sincronizzazione (chiave dell'account di servizio compresa):
-- RLS attiva senza policy = la legge solo la funzione con la chiave di servizio, mai il browser.
create table if not exists cc_sync_state (k text primary key, v text);
alter table cc_sync_state enable row level security;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- portale → Google: a ogni appuntamento inserito/modificato/cancellato chiamo la funzione (stesso formato dei webhook Supabase)
create or replace function cc_gcal_notifica() returns trigger language plpgsql security definer as $$
declare
  corpo jsonb;
begin
  corpo := jsonb_build_object('type', tg_op, 'table', tg_table_name, 'record', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
                              'old_record', case when tg_op = 'INSERT' then null else to_jsonb(old) end);
  perform net.http_post(
    url := 'https://__REF__.supabase.co/functions/v1/gcal-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer __ANON__","x-hook-secret":"__SECRET__"}'::jsonb,
    body := corpo, timeout_milliseconds := 8000);
  return null;
end $$;
drop trigger if exists cc_gcal_push_ins_upd on cc_registrazioni;
create trigger cc_gcal_push_ins_upd after insert or update on cc_registrazioni
  for each row when (new.tipo_codice like 'app_%' or new.google_event_id is not null)
  execute function cc_gcal_notifica();
drop trigger if exists cc_gcal_push_del on cc_registrazioni;
create trigger cc_gcal_push_del after delete on cc_registrazioni
  for each row when (old.google_event_id is not null)
  execute function cc_gcal_notifica();

-- Google → portale: ogni 2 minuti
select cron.unschedule('gcal-pull') where exists (select 1 from cron.job where jobname = 'gcal-pull');
select cron.schedule('gcal-pull', '*/2 * * * *',
  $$ select net.http_post(url := 'https://__REF__.supabase.co/functions/v1/gcal-sync?mode=pull',
       headers := '{"Content-Type":"application/json","Authorization":"Bearer __ANON__","x-hook-secret":"__SECRET__"}'::jsonb,
       body := '{}'::jsonb, timeout_milliseconds := 50000) $$);
