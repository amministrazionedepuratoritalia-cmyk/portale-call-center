# Portale Call Center — Depuratoritalia

Un solo file (`index.html`) + Supabase. Le telefoniste registrano quello che fanno con un tap, l'admin vede tutto in tempo reale.

## Come funziona
- **Telefonista**: entra con nome + PIN → *Inizia turno* → preme i pulsanti (Chiamate, Appuntamenti…). Ogni tap è salvato subito. In *Storico* vede il suo mese.
- **Admin**: *Adesso* (chi è in linea, totali di oggi, ultime registrazioni, aggiornamento live), *Telefoniste* (confronto per periodo), *Andamento* (grafici per giorno e per ora), *Registrazioni* (elenco, modifica, Excel), *Gestione* (telefoniste e PIN, pulsanti/attività, avvisi).

## Prima messa in funzione
1. Supabase → SQL Editor → incollare ed eseguire `supabase/schema.sql` (crea le tabelle `cc_*`, il realtime e un utente **Admin** con PIN `0000`).
2. Aprire il portale, entrare come Admin → *Gestione* → cambiare il PIN admin e aggiungere le operatrici.
3. Pubblicare: GitHub Pages → Settings → Pages → branch `main`, cartella `/`.

## Configurazione
In cima allo `<script>` di `index.html`:
- `SUPABASE_URL` / `SUPABASE_KEY` — progetto e chiave anon.
- `INIZIO_SETTIMANA` — 4 = settimana aziendale giovedì→mercoledì.
- `MINUTI_INATTIVITA` — dopo quanti minuti senza tap un'operatrice in turno risulta «ferma».

## Sincronizzazione con Google Calendar
- Calendario Google «Appuntamenti Call Center» (account amministrazionedepuratoritalia@gmail.com) condiviso con l'account di servizio `portale-call-center-sync@portale-call-center.iam.gserviceaccount.com`.
- Funzione Supabase `gcal-sync` (`supabase/functions/gcal-sync`): portale → Google a ogni modifica (trigger), Google → portale ogni 2 minuti (cron). SQL in `supabase/009-google-calendar.sql`.
- Configurazione nella tabella `cc_sync_state` (chiave dell'account di servizio, id calendario, segreto): per ricaricare la chiave, `strumenti/carica-chiave-google.sh`.
- Un evento cancellato su Google viene tolto dal calendario del portale ma l'appuntamento resta nelle statistiche.
