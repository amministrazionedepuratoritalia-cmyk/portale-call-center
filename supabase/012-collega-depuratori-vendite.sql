-- 05/11/2026 — collega il portale al calendario Google «Depuratori Vendite» (id acquamaxsrl@gmail.com, proprietario acquamaxsrl@gmail.com,
-- condiviso con l'account di servizio portale-call-center-sync@…). Da eseguire DOPO la condivisione.
update cc_sync_state set v = 'acquamaxsrl@gmail.com' where k = 'GCAL_CALENDAR_ID';
-- senza syncToken la sincronizzazione successiva rifà la lettura completa da GCAL_IMPORTA_DA (2026-10-01)
delete from cc_sync_state where k = 'syncToken';
-- spartiacque: eventi creati su Google fino al 4/11 compreso = già nei report (solo calendario); dal 5/11 in poi contano
update cc_sync_state set v = '2026-11-04T23:00:00Z' where k = 'GCAL_IMPORTATO_IL';
