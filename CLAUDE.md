# Portale Call Center — note per chi sviluppa

- App a file unico: `index.html` (HTML + CSS + JS), stesso stile del Portale Tecnici. Niente build, niente dipendenze locali.
- Backend: Supabase REST con chiave anon (stesso progetto del Portale Tecnici, tabelle con prefisso `cc_`). Login = nome + PIN dalla tabella `cc_operatrici`, nessun Supabase Auth.
- Schema in `supabase/schema.sql`: idempotente, si può rilanciare.
- Tempo reale: `supabase-js` via CDN, canale `cc-live` su `cc_registrazioni` e `cc_turni`; se il canale non si collega, l'admin si aggiorna da solo ogni 30 s.
- La data «giorno» (`data`) si calcola nel browser (ora italiana) e si manda sempre esplicita: mai affidarsi a `current_date` del server (UTC).
- Per provare senza database: copia di `index.html` senza lo script supabase-js e con un `mock.js` in fondo che ridefinisce `window.api`.
- Si risponde in italiano, corto e schematico.
