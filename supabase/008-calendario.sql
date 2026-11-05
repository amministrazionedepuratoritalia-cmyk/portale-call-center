-- 05/11/2026 — calendario appuntamenti: ora, durata, indirizzo, venditore che fa la demo
alter table cc_registrazioni add column if not exists ora_appuntamento time;
alter table cc_registrazioni add column if not exists durata_min int not null default 60;
alter table cc_registrazioni add column if not exists indirizzo text;
alter table cc_registrazioni add column if not exists venditore text;
create index if not exists cc_registrazioni_dataapp_idx on cc_registrazioni(data_appuntamento);
