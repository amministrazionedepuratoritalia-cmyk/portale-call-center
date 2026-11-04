-- 04/11/2026 — fonte del contatto (CC, Stand, Internet, Referenze): l'operatrice vede una scheda per fonte con Contatti + Appuntamenti
alter table cc_tipi add column if not exists fonte text;
update cc_tipi set fonte='CC',        ordine=1 where codice='contatto_cc';
update cc_tipi set fonte='CC',        ordine=2 where codice='app_cc';
update cc_tipi set fonte='Stand',     ordine=3 where codice='contatto_stand';
update cc_tipi set fonte='Stand',     ordine=4 where codice='app_stand';
update cc_tipi set fonte='Internet',  ordine=5 where codice='contatto_internet';
update cc_tipi set fonte='Internet',  ordine=6 where codice='app_internet';
update cc_tipi set fonte='Referenze', ordine=7 where codice='contatto_referenze';
update cc_tipi set fonte='Referenze', ordine=8 where codice='app_referenze';
