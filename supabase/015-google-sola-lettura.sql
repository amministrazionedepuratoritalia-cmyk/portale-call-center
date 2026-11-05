-- 05/11/2026 — Davide: gli eventi che stanno su Google Calendar NON vanno mai modificati dal portale.
-- origine = 'google' per le righe nate da un evento Google: per queste la funzione non scrive mai su Google
-- (niente modifiche, niente cancellazioni). 'portale' = appuntamento registrato nel portale.
alter table cc_registrazioni add column if not exists origine text not null default 'portale' check (origine in ('portale', 'google'));
update cc_registrazioni set origine = 'google' where google_event_id is not null and (solo_calendario or coalesce(note, '') like '%creato da Google Calendar%');
