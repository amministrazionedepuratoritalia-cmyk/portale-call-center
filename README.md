# Portale Call Center — Depuratoritalia

Un solo file (`index.html`) + Supabase. Le telefoniste registrano quello che fanno con un tap, l'admin vede tutto in tempo reale.

## Come funziona
- **Telefonista**: entra con nome + PIN → *Inizia turno* → preme i pulsanti (Chiamate, Appuntamenti…). Ogni tap è salvato subito. In *Storico* vede il suo mese.
- **Admin**: *Adesso* (chi è in linea, totali di oggi, ultime registrazioni, aggiornamento live), *Telefoniste* (confronto per periodo), *Andamento* (grafici per giorno e per ora), *Registrazioni* (elenco, modifica, Excel), *Gestione* (telefoniste e PIN, pulsanti/attività, avvisi).
- **Sviluppatore** (un solo account, quello di Davide): tutto quello che fa l'admin più la scheda *Sviluppatore* (account admin, stato del collegamento con Google Calendar, collegamenti utili). Gli admin gestiscono solo le telefoniste. Al login il nome si scrive a mano (nome, cognome o entrambi, in qualsiasi ordine); un account senza PIN lo imposta al primo accesso. SQL in `supabase/017-sviluppatore.sql`.

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
- Funzione Supabase `gcal-sync` (`supabase/functions/gcal-sync`): Google → portale ogni minuto (cron). **Portale → Google è SPENTO** (Davide 05/11: «non devi toccare gli appuntamenti in Google Calendar»): la funzione non modifica, non crea e non cancella eventi; si riaccende solo con `GCAL_SCRIVI = 1` in `cc_sync_state`, e comunque mai per le righe con `origine = 'google'`. SQL in `supabase/009-google-calendar.sql`, `014`, `015`.
- Telefonista: la funzione la legge dalle note dell'evento («Cognome I.» come «Mesiano E.», «Molina I.», oppure nome e cognome) e la mette nella riga, così l'appuntamento finisce nel report della telefonista giusta (`supabase/016-telefonista-dalle-note.sql` per quelli già importati). Se un evento Google corrisponde a un appuntamento già registrato nel portale (stessa data e stesso telefono o cliente) viene collegato a quella riga, non duplicato.
- Configurazione nella tabella `cc_sync_state` (chiave dell'account di servizio, id calendario, segreto): per ricaricare la chiave, `strumenti/carica-chiave-google.sh`.
- Un evento cancellato su Google viene tolto dal calendario del portale ma l'appuntamento resta nelle statistiche.
- Gli eventi che erano già su Google prima del collegamento (creati prima di `GCAL_IMPORTATO_IL` in `cc_sync_state`) entrano con `solo_calendario = true`: si vedono nel calendario e sulla lavagna della TV ma non contano nelle statistiche, perché quegli appuntamenti sono già nei dati caricati dai report. Dalla scheda dell'appuntamento l'admin può farli contare («Fallo contare»).
- Pagina TV `tv.html`: di default mostra **solo la lavagna** (`?vista=calendario` = calendario della settimana a blocchi, `?vista=entrambi`). Lavagna: nei giorni gli appuntamenti fissati (casella piena col colore della fonte; P. = Piemonte, E. = Emilia-Romagna dal campo `zona`), in fondo gli appuntamenti presi nella settimana lun–dom per fonte (`cc_tipi.caselle_lavagna`: 20, Stand 40, modificabili dall'admin nella scheda Lavagna): nero = preso per il giorno dopo, rosso = per una settimana successiva. SQL in `supabase/014-zona-e-caselle.sql`.
- Titoli degli eventi nel formato dell'ufficio: il prefisso `TO` (o «Piemonte») = zona Piemonte, `BO` (o «Emilia») = Emilia-Romagna; `(Venditore) ST - Nome Cognome 3331234567` (sigle ST = Stand, INT = Internet, CC, RF = Referenze; il venditore tra parentesi; il telefono in fondo). Il portale li legge così e li scrive così. Eventi senza sigla diventano «App. fonte non indicata» (grigi): la fonte si mette dal calendario. I promemoria con la parola «slot» non vengono importati.
- Calendario collegato: «Depuratori Vendite» (id `acquamaxsrl@gmail.com`, SQL in `supabase/012-collega-depuratori-vendite.sql`). Per collegarne un altro: condividerlo con l'account di servizio, aggiornare `GCAL_CALENDAR_ID` e cancellare la riga `syncToken` in `cc_sync_state`; alla sincronizzazione successiva (ogni minuto) rilegge tutto da `GCAL_IMPORTA_DA` (2026-01-01, «solo quest'anno») a un anno avanti, a pagine di 100 eventi con segnalibro (`pullPageToken`), così non supera i limiti della funzione. Promemoria dell'ufficio (titoli con «slot», senza lettere o con contatori tipo «0-1-1») non vengono importati. Per rifare l'importazione da zero: `supabase/013-reimporta-google.sql` (spegne i trigger mentre cancella, altrimenti cancellerebbe gli eventi su Google).
