-- 05/11/2026 — lavagna come quella fisica (Davide):
-- · zona dell'appuntamento: P = Piemonte, E = Emilia-Romagna, vuoto = Lombardia (caselle «P.» ed «E.» sotto ogni fascia)
-- · caselle in fondo per fonte: CC, Internet, Referenze 20, Stand 40 (modificabili solo dall'admin)
alter table cc_registrazioni add column if not exists zona text check (zona in ('P', 'E'));
comment on column cc_registrazioni.zona is 'P = Piemonte, E = Emilia-Romagna, null = Lombardia';
alter table cc_tipi add column if not exists caselle_lavagna int not null default 20;
update cc_tipi set caselle_lavagna = 40 where codice = 'app_stand' and caselle_lavagna = 20;

-- Trigger verso Google: niente chiamata quando l'aggiornamento viene dalla sincronizzazione stessa
-- (solo lei scrive google_sync_at), così il pull non rimanda indietro nulla.
drop trigger if exists cc_gcal_push_ins_upd on cc_registrazioni;
drop trigger if exists cc_gcal_push_ins on cc_registrazioni;
drop trigger if exists cc_gcal_push_upd on cc_registrazioni;
create trigger cc_gcal_push_ins after insert on cc_registrazioni for each row
  when (new.tipo_codice like 'app_%' or new.google_event_id is not null)
  execute function cc_gcal_notifica();
create trigger cc_gcal_push_upd after update on cc_registrazioni for each row
  when ((new.tipo_codice like 'app_%' or new.google_event_id is not null or old.tipo_codice like 'app_%') and new.google_sync_at is not distinct from old.google_sync_at)
  execute function cc_gcal_notifica();
