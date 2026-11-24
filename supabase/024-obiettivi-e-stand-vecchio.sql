-- 24/11/2026 — Davide: «dove posso modificare gli obiettivi e i vari premi?» e «si» al tasto «App. Stand vecchio».
-- 1) Obiettivi e premi delle ampolle (scheda «Obiettivi»): si cambiano dal portale, nell'account sviluppatore.
--    Stanno in cc_sync_state alla voce OBIETTIVI, testo JSON {"mesi":{"AAAA-MM":{"ampolle":{...},"pranzo":"..."}}}:
--    ogni mese usa i suoi, altrimenti quelli dell'ultimo mese salvato prima, altrimenti quelli scritti nel portale.
--    Come per TEMA, la chiave anon può scrivere SOLO questa voce (niente login lato server: il database non distingue chi scrive).
insert into cc_sync_state (k, v) values ('OBIETTIVI', '{"mesi":{}}') on conflict (k) do nothing;
drop policy if exists cc_obiettivi_scrivi on cc_sync_state;
create policy cc_obiettivi_scrivi on cc_sync_state for update using (k = 'OBIETTIVI') with check (k = 'OBIETTIVI');
drop policy if exists cc_obiettivi_inserisci on cc_sync_state;
create policy cc_obiettivi_inserisci on cc_sync_state for insert with check (k = 'OBIETTIVI');
-- 2) Tasto per le telefoniste «App. presi Stand vecchio» (fonte «Stand vecchio»), come gli altri «App. presi»: chiede cliente,
--    telefono, data e note e va su Google come gli altri appuntamenti (titolo «Stand vecchio - Cliente …», descrizione «Fonte: Stand vecchio»).
insert into cc_tipi (codice, nome, descrizione, icona, colore, ordine, attivo, chiede_dettaglio, obiettivo_giorno, gruppo, fonte, caselle_lavagna)
select 'app_stand_vecchio', 'App. presi Stand vecchio', (select descrizione from cc_tipi where codice = 'app_stand'), 'ti-calendar-check', 'pink',
       (select coalesce(max(ordine), 0) + 1 from cc_tipi), true, true, 0, 'appuntamenti', 'Stand vecchio', 20
where not exists (select 1 from cc_tipi where codice = 'app_stand_vecchio');
