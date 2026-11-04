-- 04/11/2026 — per ogni operatrice l'admin può nascondere fonti/attività (es. una vede solo CC)
alter table cc_operatrici add column if not exists tipi_nascosti text[] not null default '{}';
