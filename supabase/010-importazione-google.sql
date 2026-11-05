-- 05/11/2026 — appuntamenti già presenti su Google Calendar prima del collegamento.
-- Stanno nel calendario del portale e sulla lavagna della TV, ma NON nelle statistiche:
-- quegli appuntamenti sono già contati nei dati caricati dai report delle telefoniste.
alter table cc_registrazioni add column if not exists solo_calendario boolean not null default false;
comment on column cc_registrazioni.solo_calendario is 'true = evento creato su Google prima del collegamento (GCAL_IMPORTATO_IL): calendario e lavagna sì, statistiche no';

-- Appuntamenti di cui non si conosce la fonte (es. scritti a mano su Google): grigi, non proposti alle telefoniste.
-- La fonte la mette l'ufficio aprendo l'appuntamento dal calendario.
insert into cc_tipi (codice, nome, descrizione, icona, colore, ordine, gruppo, fonte, chiede_dettaglio, obiettivo_giorno, attivo)
values ('app_altro', 'App. fonte non indicata', 'Appuntamento arrivato da Google Calendar senza fonte: la fonte la mette l''ufficio dal calendario',
        'ti-calendar-question', 'gray', 9, 'appuntamenti', 'Non indicata', true, 0, false)
on conflict (codice) do nothing;

-- Spartiacque: gli eventi creati su Google PRIMA di questo istante non contano (sono già nei report),
-- quelli creati da qui in poi contano come appuntamenti presi.
insert into cc_sync_state (k, v)
values ('GCAL_IMPORTATO_IL', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
on conflict (k) do nothing;

-- Quando si collega un calendario (prima sincronizzazione completa) importo gli eventi da questa data in poi.
insert into cc_sync_state (k, v) values ('GCAL_IMPORTA_DA', '2026-10-01')
on conflict (k) do nothing;

-- Eventi nuovi scritti direttamente su Google senza una fonte riconoscibile: «fonte non indicata» (prima finivano su CC).
insert into cc_sync_state (k, v) values ('GCAL_FONTE_DEFAULT', 'app_altro')
on conflict (k) do update set v = excluded.v;
