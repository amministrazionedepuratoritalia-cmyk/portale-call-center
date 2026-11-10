-- 09/11/2026 — Tema stagionale del portale (Natale). Il pulsante per accenderlo e spegnerlo sta nella scheda Sviluppatore del portale;
-- vale per tutti (telefoniste, admin, TV) entro un minuto. La chiave anon può leggere e scrivere SOLO la voce TEMA
-- (come tutto il portale non c'è login lato server: il database non distingue chi scrive).
insert into cc_sync_state (k, v) values ('TEMA', 'nessuno') on conflict (k) do nothing;
drop policy if exists cc_tema_scrivi on cc_sync_state;
create policy cc_tema_scrivi on cc_sync_state for update using (k = 'TEMA') with check (k = 'TEMA');
drop policy if exists cc_tema_inserisci on cc_sync_state;
create policy cc_tema_inserisci on cc_sync_state for insert with check (k = 'TEMA');
