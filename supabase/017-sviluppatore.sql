-- 06/11/2026 — ruolo «sviluppatore» (solo Davide): tutto quello che fa l'admin più la scheda riservata del portale
-- (gestione degli account admin, stato del collegamento Google). Gli admin da qui in poi gestiscono solo le telefoniste.
alter table cc_operatrici drop constraint if exists cc_operatrici_ruolo_check;
alter table cc_operatrici add constraint cc_operatrici_ruolo_check check (ruolo in ('sviluppatore', 'admin', 'operatrice'));

-- PIN null = lo sceglie chi entra la prima volta (il primo PIN digitato al login diventa quello buono)
alter table cc_operatrici alter column pin drop not null;
comment on column cc_operatrici.pin is '4 cifre; null = da impostare al primo accesso (il primo PIN digitato al login diventa quello buono)';

insert into cc_operatrici (nome, pin, ruolo)
select 'Davide', null, 'sviluppatore'
where not exists (select 1 from cc_operatrici where ruolo = 'sviluppatore');

-- Stato del collegamento Google leggibile dal portale: data dell'ultimo aggiornamento di ogni voce
-- e lettura con la chiave anon SOLO delle voci non segrete (la chiave del service account e il segreto restano invisibili).
alter table cc_sync_state add column if not exists updated_at timestamptz not null default now();
create or replace function cc_sync_state_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists cc_sync_state_touch on cc_sync_state;
create trigger cc_sync_state_touch before update on cc_sync_state for each row execute function cc_sync_state_touch();
drop policy if exists cc_leggi_stato on cc_sync_state;
create policy cc_leggi_stato on cc_sync_state for select using (k not in ('GCAL_SERVICE_ACCOUNT', 'GCAL_HOOK_SECRET'));
