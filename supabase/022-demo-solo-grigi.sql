-- 12/11/2026 — Davide: «le demo sono tutte tranne i grigi». Anche il blu Mirtillo conta come demo fatta: non fatta SOLO il grigio Grafite (colorId 8).
-- Stessa funzione del 021, cambia solo la regola del colore. Ogni UPDATE imposta google_sync_at = clock_timestamp(): il trigger verso Google non scatta.
create or replace function cc_demo_da_google() returns integer
language plpgsql set search_path = public as $$
declare
  oggi date := (now() at time zone 'Europe/Rome')::date;   -- giorno italiano, mai current_date (UTC)
  n1 integer; n2 integer;
begin
  update cc_registrazioni r set
    demo = case when r.google_colore = '8' then 'non_fatta' else 'fatta' end,
    demo_data = r.data_appuntamento,
    google_sync_at = clock_timestamp()
  where not r.demo_manuale
    and not r.solo_calendario
    and r.google_event_id is not null
    and r.tipo_codice like 'app_%'
    and r.data_appuntamento is not null
    and r.data_appuntamento < oggi
    and r.demo is distinct from (case when r.google_colore = '8' then 'non_fatta' else 'fatta' end);
  get diagnostics n1 = row_count;
  update cc_registrazioni r set demo = null, demo_data = null, google_sync_at = clock_timestamp()
  where not r.demo_manuale
    and r.demo is not null
    and (r.solo_calendario or r.google_event_id is null or r.data_appuntamento is null or r.data_appuntamento >= oggi or r.tipo_codice not like 'app_%');
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

select public.cc_demo_da_google() as righe_aggiornate;
