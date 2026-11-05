-- 05/11/2026 — registrazioni senza telefonista (demo dirette dei consulenti / stand): contano sulla fonte, non su una persona
alter table cc_registrazioni alter column operatrice_id drop not null;
update cc_registrazioni set operatrice_id = null
 where operatrice_id in (select id from cc_operatrici where nome = 'Diretti (consulenti / stand)');
delete from cc_operatrici where nome = 'Diretti (consulenti / stand)';
