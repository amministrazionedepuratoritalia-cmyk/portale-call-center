-- 06/11/2026 — Davide: «gli appuntamenti inseriti dal portale non vengono copiati in Google Calendar».
-- Scrittura verso Google RIACCESA, ma solo per gli appuntamenti nati nel portale (origine = 'portale'):
-- gli eventi nati su Google non si toccano mai (regola del 05/11, resta nella funzione).
-- GCAL_SCRIVI_DA: crea eventi su Google solo per le righe registrate da questa data in poi (niente creazioni a ritroso).
insert into cc_sync_state (k, v) values ('GCAL_SCRIVI', '1') on conflict (k) do update set v = excluded.v;
insert into cc_sync_state (k, v) values ('GCAL_SCRIVI_DA', '2026-11-05') on conflict (k) do update set v = excluded.v;

-- Gli appuntamenti durano 2 ore, come quelli dell'ufficio su Google
alter table cc_registrazioni alter column durata_min set default 120;
