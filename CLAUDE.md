# Portale Call Center — note per chi sviluppa

- App a file unico: `index.html` (HTML + CSS + JS), stesso stile del Portale Tecnici. Niente build, niente dipendenze locali.
- Backend: Supabase REST con chiave anon (stesso progetto del Portale Tecnici, tabelle con prefisso `cc_`). Login = nome scritto a mano (`cercaOperatrice`: parole del nome in qualsiasi ordine, anche solo nome o cognome) + PIN dalla tabella `cc_operatrici`, nessun Supabase Auth; PIN null = lo imposta il primo login. Ruoli: `operatrice`, `admin`, `sviluppatore` (solo Davide: `isAdmin()` = admin o sviluppatore, `isDev()` = scheda «Sviluppatore» riservata; solo lui crea/modifica gli admin).
- Schema in `supabase/schema.sql`: idempotente, si può rilanciare.
- Tempo reale: `supabase-js` via CDN, canale `cc-live` su `cc_registrazioni` e `cc_turni`; se il canale non si collega, l'admin si aggiorna da solo ogni 30 s.
- La data «giorno» (`data`) si calcola nel browser (ora italiana) e si manda sempre esplicita: mai affidarsi a `current_date` del server (UTC).
- Per provare senza database: copia di `index.html` senza lo script supabase-js e con un `mock.js` in fondo che ridefinisce `window.api`.
- Si risponde in italiano, corto e schematico.
- Righe con `solo_calendario = true` (eventi importati da Google Calendar): calendario e lavagna TV sì, statistiche no. Ogni lettura di `cc_registrazioni` per le statistiche filtra `solo_calendario=is.false`.
- Mai inventare attribuzioni: un appuntamento senza fonte certa è `app_altro` («Fonte non indicata»), senza telefonista è `operatrice_id` null.
- Google Calendar: gli eventi nati su Google (`origine = 'google'`) non si toccano MAI (la funzione `gcal-sync` esce subito). Gli appuntamenti nati nel portale vengono copiati su Google (2 ore, colore della fonte) se `GCAL_SCRIVI = 1`. Mai UPDATE di massa su `cc_registrazioni` senza `google_sync_at = now()` o trigger spenti.
- Tema stagionale: chiave `TEMA` in `cc_sync_state` ('nessuno' | 'natale'), letta da index.html e tv.html all'avvio e ogni 60 s (`controllaTema` → `applicaTema`); CSS scoperto da `body.tema-natale`, decorazioni create in `decoraNatale()` e rimosse tutte in `applicaTema('nessuno')`. Il pulsante per cambiarla (`impostaTema`) sta solo nella scheda Sviluppatore; lato database la chiave anon può scrivere solo quella voce, non è vincolato chi (niente login lato server in tutto il portale). Dentro il portale neve e alberi stanno dietro ai contenuti (z-index -1) e spariscono con le classi `login-aperto` / `scheda-larga` sul body. Il tema non tocca i colori dei dati.
