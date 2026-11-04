-- 04/11/2026 — due squadre (Mattino / Pomeriggio): l'admin le vede separate
alter table cc_operatrici add column if not exists squadra text;
