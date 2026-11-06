-- 06/11/2026 — Davide: «i colori del calendario devono rispecchiare quelli di Google Calendar».
-- Colore dell'evento su Google (colorId 1–11, null = colore normale del calendario): il portale lo legge a ogni sincronizzazione
-- e lo usa nel calendario (portale e TV) al posto del colore della fonte.
alter table cc_registrazioni add column if not exists google_colore text;
comment on column cc_registrazioni.google_colore is 'colorId dell''evento su Google Calendar (1 Lavanda … 11 Pomodoro); null = colore normale del calendario';
