-- 12/11/2026 — Demo fatte lette dal calendario Google.
-- Davide: «sul portale c'è il calendario appuntamenti che rispecchia Google Calendar: fai sì che il grafico si aggiorni con i dati corretti».
-- L'ufficio ricolora su Google gli appuntamenti DOPO che sono avvenuti (quelli futuri non sono mai grigi né blu Mirtillo):
--   grigio Grafite (colorId 8) = saltato · blu Mirtillo (colorId 9) = da richiamare/riconfermare → demo NON fatta
--   qualsiasi altro colore (o nessuno) → demo FATTA
-- Verifica sui dati: settimana del 22/10, 106 appuntamenti − 29 grigi = 77 = le demo del report dell'ufficio.
-- Vale solo per gli appuntamenti che contano nelle statistiche (non «solo calendario»), già passati e collegati a un evento Google.
-- Un esito scelto a mano nel portale (Demo fatta / Non fatta / torna da fare) non viene mai cambiato: colonna demo_manuale.
-- Ogni UPDATE imposta google_sync_at = clock_timestamp(): così il trigger verso Google NON scatta (Google non viene mai toccato da qui).

alter table cc_registrazioni add column if not exists demo_manuale boolean not null default false;
comment on column cc_registrazioni.demo_manuale is 'true = esito della demo scelto a mano nel portale: cc_demo_da_google() non lo cambia';

-- esiti già presenti (le demo caricate dai report e quelle segnate a mano): restano come sono
update cc_registrazioni set demo_manuale = true, google_sync_at = clock_timestamp()
where demo is not null and not demo_manuale;

create or replace function cc_demo_da_google() returns integer
language plpgsql set search_path = public as $$
declare
  oggi date := (now() at time zone 'Europe/Rome')::date;   -- giorno italiano, mai current_date (UTC)
  n1 integer; n2 integer;
begin
  -- appuntamenti già avvenuti: esito dal colore dell'evento su Google
  update cc_registrazioni r set
    demo = case when r.google_colore in ('8','9') then 'non_fatta' else 'fatta' end,
    demo_data = r.data_appuntamento,
    google_sync_at = clock_timestamp()
  where not r.demo_manuale
    and not r.solo_calendario
    and r.google_event_id is not null
    and r.tipo_codice like 'app_%'
    and r.data_appuntamento is not null
    and r.data_appuntamento < oggi
    and r.demo is distinct from (case when r.google_colore in ('8','9') then 'non_fatta' else 'fatta' end);
  get diagnostics n1 = row_count;
  -- esiti automatici che non valgono più (appuntamento spostato in avanti, tolto dal calendario o scollegato da Google): di nuovo «da fare»
  update cc_registrazioni r set demo = null, demo_data = null, google_sync_at = clock_timestamp()
  where not r.demo_manuale
    and r.demo is not null
    and (r.solo_calendario or r.google_event_id is null or r.data_appuntamento is null or r.data_appuntamento >= oggi or r.tipo_codice not like 'app_%');
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

-- ogni 5 minuti (la lettura da Google gira ogni minuto: un cambio di colore arriva nel grafico entro qualche minuto)
select cron.unschedule('cc-demo-google') where exists (select 1 from cron.job where jobname = 'cc-demo-google');
select cron.schedule('cc-demo-google', '*/5 * * * *', 'select public.cc_demo_da_google()');

-- prima passata subito
select public.cc_demo_da_google() as righe_aggiornate;
