-- 05/11/2026 — Davide: «falla solo di quest'anno». Pulizia della prima importazione (aveva preso tutto il calendario dal 2020
-- e i promemoria ricorrenti fino al 2040) e nuova lettura completa dal 1° gennaio 2026 a un anno avanti.
-- I trigger restano spenti durante la cancellazione: le righe importate NON devono cancellare gli eventi su Google.
begin;
alter table cc_registrazioni disable trigger cc_gcal_push_ins_upd;
alter table cc_registrazioni disable trigger cc_gcal_push_del;
delete from cc_registrazioni where google_event_id is not null;
alter table cc_registrazioni enable trigger cc_gcal_push_ins_upd;
alter table cc_registrazioni enable trigger cc_gcal_push_del;
update cc_sync_state set v = '2026-01-01' where k = 'GCAL_IMPORTA_DA';
delete from cc_sync_state where k in ('syncToken', 'pullPageToken', 'pullFinestra', 'pullLock');
commit;
