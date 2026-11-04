-- 04/11/2026 — attività divise per fonte: Contatti (CC, Stand, Internet, Referenze) e Appuntamenti presi (stesse fonti)
alter table cc_tipi add column if not exists gruppo text;   -- 'contatti' | 'appuntamenti' | null

delete from cc_tipi where codice in ('chiamata','risposta','appuntamento','confermato','richiamo','non_interessato')
  and not exists (select 1 from cc_registrazioni r where r.tipo_codice=cc_tipi.codice);

insert into cc_tipi (codice, nome, descrizione, icona, colore, ordine, gruppo, chiede_dettaglio, obiettivo_giorno) values
  ('contatto_cc',        'Contatti CC',        'Contatti dal call center',  'ti-phone',          'blue',   1, 'contatti',     false, 0),
  ('contatto_stand',     'Contatti Stand',     'Contatti presi allo stand', 'ti-building-store', 'amber',  2, 'contatti',     false, 0),
  ('contatto_internet',  'Contatti Internet',  'Contatti arrivati dal web', 'ti-world',          'indigo', 3, 'contatti',     false, 0),
  ('contatto_referenze', 'Contatti Referenze', 'Contatti da referenze',     'ti-users',          'green',  4, 'contatti',     false, 0),
  ('app_cc',             'App. presi CC',        'Appuntamento da contatto CC',        'ti-calendar-check', 'blue',   5, 'appuntamenti', true, 0),
  ('app_stand',          'App. presi Stand',     'Appuntamento da contatto Stand',     'ti-calendar-check', 'amber',  6, 'appuntamenti', true, 0),
  ('app_internet',       'App. presi Internet',  'Appuntamento da contatto Internet',  'ti-calendar-check', 'indigo', 7, 'appuntamenti', true, 0),
  ('app_referenze',      'App. presi Referenze', 'Appuntamento da contatto Referenze', 'ti-calendar-check', 'green',  8, 'appuntamenti', true, 0)
on conflict (codice) do update set nome=excluded.nome, descrizione=excluded.descrizione, icona=excluded.icona, colore=excluded.colore, ordine=excluded.ordine, gruppo=excluded.gruppo, chiede_dettaglio=excluded.chiede_dettaglio;
