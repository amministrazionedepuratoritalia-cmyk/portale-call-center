-- 05/11/2026 — l'admin segna se la demo dell'appuntamento è stata fatta; le telefoniste lo vedono ma non lo cambiano
alter table cc_registrazioni add column if not exists demo text check (demo in ('fatta','non_fatta'));
alter table cc_registrazioni add column if not exists demo_data date;
