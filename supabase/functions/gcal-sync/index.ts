// Sincronizzazione a doppio senso tra gli appuntamenti del Portale Call Center (cc_registrazioni)
// e un calendario Google condiviso con l'account di servizio.
//
//   portale → Google : chiamata dal trigger del database (webhook) a ogni insert/update/delete di un appuntamento
//   Google → portale : chiamata dal cron ogni 2 minuti (?mode=pull), con syncToken incrementale
//
// Variabili d'ambiente (supabase secrets) o righe di cc_sync_state: GCAL_SERVICE_ACCOUNT (json della chiave), GCAL_CALENDAR_ID,
// GCAL_HOOK_SECRET (deve coincidere con l'header x-hook-secret), GCAL_FONTE_DEFAULT (tipo per gli eventi senza fonte, es. app_altro),
// GCAL_IMPORTATO_IL (istante del collegamento: gli eventi creati su Google prima stanno solo nel calendario, non nelle statistiche),
// GCAL_IMPORTA_DA (data da cui importare alla prima sincronizzazione completa di un calendario).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const TZ = "Europe/Rome";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
// Configurazione: dalle variabili d'ambiente oppure dalla tabella cc_sync_state (protetta da RLS, la legge solo la chiave di servizio)
let SA: any = {}, CAL_ID = "", HOOK_SECRET = "", FONTE_DEFAULT = "app_cc", IMPORTATO_IL = "", IMPORTA_DA = "", SCRIVI = false, SCRIVI_DA = "", _cfgAt = 0;
async function config() {
  if (Date.now() - _cfgAt < 60000 && HOOK_SECRET) return;
  const righe = (await sb.from("cc_sync_state").select("k,v")).data || [];
  const cfg = (k: string) => Deno.env.get(k) || righe.find((r: any) => r.k === k)?.v || "";
  SA = JSON.parse(cfg("GCAL_SERVICE_ACCOUNT") || "{}"); CAL_ID = cfg("GCAL_CALENDAR_ID"); HOOK_SECRET = cfg("GCAL_HOOK_SECRET"); FONTE_DEFAULT = cfg("GCAL_FONTE_DEFAULT") || "app_cc";
  IMPORTATO_IL = cfg("GCAL_IMPORTATO_IL"); IMPORTA_DA = cfg("GCAL_IMPORTA_DA"); SCRIVI = cfg("GCAL_SCRIVI") === "1"; SCRIVI_DA = cfg("GCAL_SCRIVI_DA");   // scrittura portale → Google: solo se GCAL_SCRIVI = 1, e crea eventi solo per le righe registrate (data) da GCAL_SCRIVI_DA in poi
  _cfgAt = Date.now();
}

// ── token Google con l'account di servizio (JWT RS256) ──
let _tok: { v: string; exp: number } | null = null;
function b64url(x: string | ArrayBuffer) {
  const s = typeof x === "string" ? btoa(unescape(encodeURIComponent(x))) : btoa(String.fromCharCode(...new Uint8Array(x)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function token() {
  if (_tok && _tok.exp > Date.now() / 1000 + 60) return _tok.v;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: SA.client_email, scope: "https://www.googleapis.com/auth/calendar", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = String(SA.private_key).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(header + "." + claim));
  const jwt = header + "." + claim + "." + b64url(sig);
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwt });
  const j = await r.json();
  if (!j.access_token) throw new Error("token Google: " + JSON.stringify(j));
  _tok = { v: j.access_token, exp: now + (j.expires_in || 3600) };
  return _tok.v;
}
async function gapi(path: string, method = "GET", body?: unknown) {
  const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(CAL_ID) + path, {
    method, headers: { Authorization: "Bearer " + await token(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error("Google " + r.status + " " + JSON.stringify(j).slice(0, 300)), { status: r.status, j });
  return j;
}

// ── tabelle di appoggio ──
type Tipo = { codice: string; nome: string; fonte: string | null; gruppo: string | null; colore: string };
type Op = { id: number; nome: string };
let _tipi: Tipo[] = [], _ops: Op[] = [];
async function base() {
  const [t, o] = await Promise.all([sb.from("cc_tipi").select("codice,nome,fonte,gruppo,colore"), sb.from("cc_operatrici").select("id,nome")]);
  _tipi = t.data || []; _ops = o.data || [];
}
const tipoDi = (c: string) => _tipi.find((t) => t.codice === c);
const opDi = (id: number | null) => _ops.find((o) => o.id === id);
const isApp = (c: string) => tipoDi(c)?.gruppo === "appuntamenti";
// Colore dell'evento su Google = colore della fonte nel calendario del gestionale (Davide 06/11): blu CC → Pavone, ambra Stand → Mandarino,
// indigo Internet → Mirtillo, verde Referenze → Basilico, grigio «non indicata» → Grafite
const COLORI: Record<string, string> = { blue: "7", amber: "6", indigo: "9", green: "10", purple: "3", red: "11", pink: "4", gray: "8" };

// ── data/ora ──
function addMin(data: string, ora: string, min: number) {
  const [y, m, d] = data.split("-").map(Number), [hh, mm] = ora.split(":").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm) + min * 60000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}T${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}:00`;
}
function addDays(data: string, n: number) { const [y, m, d] = data.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
// Parte locale (Europe/Rome) di un dateTime Google, qualunque offset abbia
const FMT_LOCALE = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const FMT_OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" });
function locale(dt: string) {
  const p = FMT_LOCALE.formatToParts(new Date(dt));
  const g = (k: string) => p.find((x) => x.type === k)?.value;
  return { data: `${g("year")}-${g("month")}-${g("day")}`, ora: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}` };
}

// ── titoli come li scrive l'ufficio su Google: "(Venditore) ST - Nome Cognome 3331234567", "TO riconf.CC - Nome", "INT - Nome" ──
const SIGLE: Record<string, string> = { ST: "Stand", INT: "Internet", CC: "CC", RF: "Referenze" };
const siglaDi = (fonte: string) => Object.keys(SIGLE).find((k) => SIGLE[k].toLowerCase() === (fonte || "").toLowerCase()) || "";
const pareVenditore = (v: string) => { const t = v.trim(); return !!t && !/[\d,.]/.test(t) && /^[A-ZÀ-Ý]/.test(t) && t.split(/\s+/).length <= 5; };
function daTitolo(summary: string) {
  let s = (summary || "").trim(), venditore: string | null = null;
  // «(Nome Cognome)» o «(Stefano Banfi + Carlo)» all'inizio = consulente; una frase tra parentesi (cifre, virgole, punti, minuscola iniziale, più di 5 parole) è una nota dell'ufficio e resta nel nome
  const mv = s.match(/^\(([^)]+)\)\s*/);
  if (mv && pareVenditore(mv[1])) { venditore = mv[1].trim(); s = s.slice(mv[0].length); }
  const mf = s.match(/(^|[^A-Za-z])(ST|INT|CC|RF)(?![A-Za-z])/i);           // sigla della fonte, dove sia nel titolo
  const fonte = mf ? SIGLE[mf[2].toUpperCase()] : null;
  let resto = s, prefisso = "";
  if (mf) { prefisso = s.slice(0, mf.index! + mf[1].length); const dopo = s.slice(mf.index! + mf[0].length).replace(/^[\s.:–-]+/, ""); if (dopo) resto = dopo; }
  else { const md = s.match(/^(.*?)\s*[-–]\s*(.+)$/); if (md) { prefisso = md[1]; resto = md[2]; } }
  // zona: "TO" / "Piemonte" = Piemonte, "BO" / "Emilia" = Emilia-Romagna (scritti prima della sigla); altrimenti Lombardia
  const mz = prefisso.match(/(^|[^A-Za-z])(TO|BO|PIEMONTE|EMILIA)(?![A-Za-z])/i);
  const zona = mz ? (/^(TO|PIEMONTE)$/i.test(mz[2]) ? "P" : "E") : null;
  let telefono: string | null = null;
  const mt = resto.match(/\s*(\+?\d[\d .\/]{7,}\d)\s*$/); if (mt) { telefono = mt[1].replace(/[ .\/]/g, ""); resto = resto.slice(0, mt.index).trim(); }
  const cliente = resto.replace(/[\s–-]+$/, "").trim() || null;
  return { venditore, fonte, cliente, telefono, zona };
}
// Titoli che non sono appuntamenti: contengono «slot», oppure non hanno lettere, oppure hanno un contatore a cifre singole tipo 0-1-1
const isPromemoria = (sum: string) => /\bslot\b/i.test(sum) || !/[A-Za-zÀ-ÿ]/.test(sum) || /(^|\s)\d(-\d)+(\s|$)/.test(sum);
function tipoPerFonte(nome: string) {
  const n = (nome || "").trim().toLowerCase(); if (!n) return null;
  return _tipi.find((x) => x.gruppo === "appuntamenti" && (x.fonte || x.nome).toLowerCase() === n) ||
    _tipi.find((x) => x.gruppo === "appuntamenti" && (x.fonte || "").toLowerCase().startsWith(n.slice(0, 3))) || null;
}

// Il titolo su Google dice già le stesse cose della riga (cliente, telefono, venditore, fonte)?
function titoloEquivale(summary: string, r: any) {
  if (!summary || summary.includes(" · ")) return false;
  const t = daTitolo(summary), tf = t.fonte ? tipoPerFonte(t.fonte) : null;
  const same = (a: any, b: any) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  return same(t.cliente, r.cliente) && same(t.telefono, r.telefono) && same(t.venditore, r.venditore) && same(t.zona, r.zona) && (tf ? tf.codice === r.tipo_codice : r.tipo_codice === "app_altro");
}

// ── portale → Google: come deve apparire l'evento (titolo nel formato dell'ufficio) ──
function eventoDa(r: any) {
  const t = tipoDi(r.tipo_codice), op = opDi(r.operatrice_id);
  const fonte = t?.codice === "app_altro" ? "" : (t?.fonte || t?.nome || "");
  const sigla = fonte ? (siglaDi(fonte) || fonte) : "", zona = r.zona === "P" ? "TO " : r.zona === "E" ? "BO " : "";
  const demo = r.demo === "fatta" ? "fatta" + (r.demo_data ? " il " + r.demo_data.split("-").reverse().join("/") : "") : r.demo === "non_fatta" ? "non fatta" : "da fare";
  const desc = [
    r.telefono ? "Telefono: " + r.telefono : "", "Fonte: " + (fonte || "non indicata"), "Telefonista: " + (op?.nome || "nessuna"),
    r.venditore ? "Venditore: " + r.venditore : "", "Demo: " + demo, r.note ? "Note: " + r.note : "",
    "", "— Portale Call Center #" + r.id,
  ].filter((x) => x !== "").join("\n");
  const ev: any = {
    summary: `${r.venditore ? "(" + r.venditore + ") " : ""}${zona}${sigla ? sigla + " - " : ""}${r.cliente || "Cliente non indicato"}${r.telefono ? " " + r.telefono : ""}`,
    location: r.indirizzo || "", description: desc, colorId: COLORI[t?.colore || "blue"] || "9",
    extendedProperties: { private: { cc_id: String(r.id) } },
  };
  if (r.ora_appuntamento) {
    const ora = String(r.ora_appuntamento).slice(0, 5);
    ev.start = { dateTime: `${r.data_appuntamento}T${ora}:00`, timeZone: TZ };
    ev.end = { dateTime: addMin(r.data_appuntamento, ora, r.durata_min || 120), timeZone: TZ };   // 2 ore come gli appuntamenti dell'ufficio
  } else { ev.start = { date: r.data_appuntamento }; ev.end = { date: addDays(r.data_appuntamento, 1) }; }
  return ev;
}
function istante(x: any) { if (!x) return ""; if (x.date) return "D" + x.date; const s = String(x.dateTime); return /[+-]\d\d:\d\d$|Z$/.test(s) ? String(new Date(s).getTime()) : String(new Date(s + romaOffset(s)).getTime()); }
// offset di Europe/Rome per un dateTime senza fuso (es. 2026-11-06T11:00:00): +01:00 o +02:00
function romaOffset(s: string) { const d = new Date(s + "Z"); const p = FMT_OFFSET.formatToParts(d).find((x) => x.type === "timeZoneName")?.value || "GMT+01:00"; const m = p.match(/([+-])(\d\d):(\d\d)/); return m ? m[1] + m[2] + ":" + m[3] : "+01:00"; }
const uguale = (a: any, b: any) => ["summary", "location", "description"].every((k) => (a[k] || "").trim() === (b[k] || "").trim()) &&
  istante(a.start) === istante(b.start) && istante(a.end) === istante(b.end);

async function push(tipo: string, record: any, old: any) {
  const r = record || old;
  if (!r || !isApp(r.tipo_codice) && !(old && isApp(old.tipo_codice))) return "non è un appuntamento";
  // REGOLA (Davide 05/11): gli eventi nati su Google Calendar non si toccano mai: né modifiche né cancellazioni
  if (r.origine === "google" || old?.origine === "google") return "nato su Google: non si tocca";
  // la scrittura verso Google degli appuntamenti nati nel portale si accende con GCAL_SCRIVI = 1 (riaccesa il 06/11 su richiesta di Davide)
  if (!SCRIVI) return "scrittura su Google spenta";
  // riga appena creata dal pull (l'evento esiste già su Google): lo lascio com'è
  if (tipo === "INSERT" && record?.google_event_id) return "arrivato da Google";
  // cancellato, o tolto dal calendario (niente data): elimino l'evento Google
  if (tipo === "DELETE" || !record.data_appuntamento || !isApp(record.tipo_codice)) {
    const gid = (record || old)?.google_event_id || old?.google_event_id;
    if (gid) { try { await gapi("/events/" + gid, "DELETE"); } catch (e: any) { if (e.status !== 404 && e.status !== 410) throw e; } }
    if (record && record.google_event_id) await sb.from("cc_registrazioni").update({ google_event_id: null }).eq("id", record.id);
    return "evento eliminato";
  }
  const voluto = eventoDa(record);
  if (record.google_event_id) {
    let esistente: any = null;
    try { esistente = await gapi("/events/" + record.google_event_id); } catch (e: any) { if (e.status !== 404 && e.status !== 410) throw e; }
    if (esistente && esistente.status !== "cancelled") {
      // il titolo scritto dall'ufficio (es. «TO riconf.CC - Nome 333…») resta com'è finché cliente, telefono, venditore e fonte non cambiano nel portale
      if (titoloEquivale(esistente.summary, record)) voluto.summary = esistente.summary;
      if (uguale(esistente, voluto)) return "già allineato";
      await gapi("/events/" + record.google_event_id, "PATCH", voluto);
      await sb.from("cc_registrazioni").update({ google_sync_at: new Date().toISOString() }).eq("id", record.id);
      return "evento aggiornato";
    }
  }
  // eventi nuovi solo per gli appuntamenti registrati da GCAL_SCRIVI_DA in poi: niente creazioni a ritroso per righe vecchie che vengono ritoccate
  if (SCRIVI_DA && String(record.data || "") < SCRIVI_DA) return "registrato prima di " + SCRIVI_DA + ": non lo creo su Google";
  // l'ufficio l'ha già scritto a mano su Google (riga arrivata dal pull, stesso giorno e stesso cliente/telefono)? mi collego a quello invece di crearne un doppio
  const gemello = await gemelloGoogle(record);
  if (gemello) {
    const u = unione(record, { data_appuntamento: gemello.data_appuntamento, ora_appuntamento: gemello.ora_appuntamento, durata_min: gemello.durata_min, indirizzo: gemello.indirizzo, zona: gemello.zona, venditore: gemello.venditore, cliente: gemello.cliente, telefono: gemello.telefono, note: gemello.note, google_event_id: gemello.google_event_id, google_sync_at: new Date().toISOString() });
    await sb.from("cc_registrazioni").update(u).eq("id", record.id);
    await sb.from("cc_registrazioni").delete().eq("id", gemello.id);   // la riga doppia arrivata da Google: resta quella della telefonista
    return "collegato all'evento già scritto su Google (riga doppia #" + gemello.id + " unita)";
  }
  const creato = await gapi("/events", "POST", voluto);
  await sb.from("cc_registrazioni").update({ google_event_id: creato.id, google_sync_at: new Date().toISOString() }).eq("id", record.id);
  return "evento creato " + creato.id;
}

// ── Google → portale ──
// Fonte: dalla riga «Fonte:» della descrizione (nostro formato), altrimenti dalla sigla nel titolo (ST / INT / CC / RF), altrimenti «non indicata»
function fonteDa(ev: any): string {
  const m = (ev.description || "").match(/^Fonte:\s*([^\n]+)/im);
  const daDesc = m ? tipoPerFonte(m[1]) : null; if (daDesc) return daDesc.codice;
  const sum = ev.summary || "";
  const vecchio = sum.includes(" · ") ? tipoPerFonte(sum.split(" · ")[1] || "") : null; if (vecchio) return vecchio.codice;
  const tit = daTitolo(sum); const daTit = tit.fonte ? tipoPerFonte(tit.fonte) : null;
  return daTit?.codice || FONTE_DEFAULT;
}
function campo(desc: string, k: string) { const m = (desc || "").match(new RegExp("^" + k + ":\\s*(.*)$", "mi")); return m ? m[1].trim() : null; }
// Note: nel nostro formato stanno dopo «Note:» fino al marcatore finale (anche su più righe);
// una descrizione scritta a mano su Google (senza i nostri campi) va tutta nelle note
function noteDa(desc: string) {
  const d = (desc || "").trim();
  if (!d) return null;
  if (!/^(Telefono|Fonte|Telefonista|Venditore|Demo|Note):/mi.test(d)) return d;
  const m = d.match(/(?:^|\n)Note:\s*([\s\S]*?)(?:\n+— Portale Call Center[^\n]*)?\s*$/i);
  return m ? m[1].trim() : null;
}
const senzaTag = (s: any) => String(s ?? "").replace(/\s*(·\s*)?creato da Google Calendar\s*$/, "").trim();

// ── Doppioni: lo stesso appuntamento scritto sia nel portale (telefonista) sia a mano su Google (ufficio) ──
// Stesso giorno + stesso telefono (solo cifre, senza +39) oppure stesso nome (parole in qualsiasi ordine, senza accenti)
const telNorm = (t: any) => { let d = String(t ?? "").replace(/\D/g, ""); if (d.startsWith("0039")) d = d.slice(4); else if (d.startsWith("39") && d.length > 10) d = d.slice(2); return d; };
const nomeNorm = (c: any) => String(c ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
const stessoCliente = (a: any, b: any) => { const ta = telNorm(a.telefono), tb = telNorm(b.telefono); if (ta && ta === tb) return true; const na = nomeNorm(a.cliente), nb = nomeNorm(b.cliente); return !!na && na === nb; };
// La riga del portale resta quella «vera» (telefonista, fonte, cliente e telefono come li ha scritti lei): da Google prendo giorno/ora e quello che le manca
function unione(riga: any, agg: any) {
  const u: any = { ...agg, origine: "google" };
  for (const k of ["cliente", "telefono", "operatrice_id", "venditore", "indirizzo", "zona"]) if (k in u && riga[k] != null && riga[k] !== "") u[k] = riga[k];
  u.note = riga.note || agg.note || null;
  if (agg.note && riga.note && senzaTag(agg.note) !== senzaTag(riga.note)) u.note = senzaTag(riga.note) + " · " + senzaTag(agg.note);
  return u;
}
// Riga arrivata da Google (scritta a mano dall'ufficio) che è lo stesso appuntamento di questa riga del portale
async function gemelloGoogle(r: any) {
  if (!r.data_appuntamento) return null;
  const cand = (await sb.from("cc_registrazioni").select("*").eq("origine", "google").eq("data_appuntamento", r.data_appuntamento).like("tipo_codice", "app_%").not("google_event_id", "is", null).neq("id", r.id)).data || [];
  return cand.find((c: any) => stessoCliente(r, c)) || null;
}
// Cancella un evento su Google SOLO se l'abbiamo creato noi (creatore = service account, o nostra firma): quelli dell'ufficio non si toccano mai
async function eliminaNostro(gid: string) {
  let ev: any = null;
  try { ev = await gapi("/events/" + gid); } catch (e: any) { if (e.status === 404 || e.status === 410) return false; throw e; }
  if (!ev || ev.status === "cancelled") return false;
  const nostro = (SA.client_email && ev.creator?.email === SA.client_email) || !!ev.extendedProperties?.private?.cc_id;
  if (!nostro) return false;
  await gapi("/events/" + gid, "DELETE");
  return true;
}
// La telefonista è scritta nelle note dell'evento come «Cognome I.» (Mesiano E., Molina I., Monti G, Carletti D.) o nome e cognome per esteso.
// Serve cognome + iniziale (o il nome completo): il solo nome di battesimo non basta, nelle note c'è anche il nome della promoter.
const esc_ = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function telefonistaDa(testo: string): Op | null {
  const t = (testo || "").replace(/<[^>]+>/g, " ");
  const trovate = _ops.filter((o) => {
    const parole = o.nome.trim().split(/\s+/).filter((w) => w.length >= 2);
    if (parole.length < 2) return false;
    const rx: string[] = [];
    parole.forEach((w, i) => { if (w.length < 4) return; parole.forEach((z, j) => { if (i !== j) rx.push(`\\b${esc_(w)}\\s*${esc_(z[0])}\\.?(?![a-zà-ÿ])`); }); });
    rx.push(`\\b${parole.map(esc_).join("\\s+")}\\b`, `\\b${parole.slice().reverse().map(esc_).join("\\s+")}\\b`);
    return rx.some((r) => new RegExp(r, "i").test(t));
  });
  return trovate.length === 1 ? trovate[0] : null;
}
async function applica(ev: any, riga: any) {
  if (ev.status === "cancelled") {
    // importato (solo calendario) cancellato su Google: via anche dal portale, non era nelle statistiche
    if (riga?.solo_calendario) { await sb.from("cc_registrazioni").delete().eq("id", riga.id); return "importato cancellato #" + riga.id; }
    // l'ufficio ha cancellato un evento creato dal portale perché lo aveva già scritto a mano? la riga si collega a quello, non perde la data
    if (riga && riga.data_appuntamento && riga.origine === "portale") {
      const g = await gemelloGoogle(riga);
      if (g) {
        const u = unione(riga, { data_appuntamento: g.data_appuntamento, ora_appuntamento: g.ora_appuntamento, durata_min: g.durata_min, indirizzo: g.indirizzo, zona: g.zona, venditore: g.venditore, cliente: g.cliente, telefono: g.telefono, note: g.note, google_event_id: g.google_event_id, google_sync_at: new Date().toISOString() });
        await sb.from("cc_registrazioni").update(u).eq("id", riga.id);
        await sb.from("cc_registrazioni").delete().eq("id", g.id);
        return "doppione tolto dall'ufficio: riga #" + riga.id + " collegata all'evento scritto a mano (riga doppia #" + g.id + " unita)";
      }
    }
    // cancellato su Google: lo tolgo dal calendario del portale ma l'appuntamento preso resta nelle statistiche
    if (riga && riga.data_appuntamento) await sb.from("cc_registrazioni").update({ data_appuntamento: null, ora_appuntamento: null, google_event_id: null, google_sync_at: new Date().toISOString(), note: [riga.note, "tolto dal calendario Google"].filter(Boolean).join(" · ") }).eq("id", riga.id);
    return riga ? "tolto dal calendario" : "ignorato";
  }
  const tuttoIlGiorno = !!ev.start?.date;
  const inizio = tuttoIlGiorno ? { data: ev.start.date, ora: null } : locale(ev.start.dateTime);
  const fine = tuttoIlGiorno ? null : locale(ev.end.dateTime);
  const durata = fine ? Math.max(15, Math.round((new Date(ev.end.dateTime).getTime() - new Date(ev.start.dateTime).getTime()) / 60000)) : (riga?.durata_min || 60);
  const desc = ev.description || "", sum = ev.summary || "", tit = daTitolo(sum);
  const cliente = sum.includes(" · ") ? sum.split(" · ")[0].trim() || null : tit.cliente;
  const agg: any = { data_appuntamento: inizio.data, ora_appuntamento: inizio.ora, durata_min: durata, indirizzo: ev.location || null, zona: tit.zona, google_event_id: ev.id, google_sync_at: new Date().toISOString() };
  if (cliente && cliente !== "Cliente non indicato") agg.cliente = cliente;
  const tel = campo(desc, "Telefono") ?? tit.telefono, ven = campo(desc, "Venditore") ?? tit.venditore, note = noteDa(desc);
  if (tel !== null) agg.telefono = tel || null;
  if (ven !== null) agg.venditore = ven || null;
  if (note !== null) agg.note = note || null;
  // telefonista dalle note (solo se la riga non ce l'ha già)
  const opNote = telefonistaDa(desc + "\n" + sum);
  if (opNote && !riga?.operatrice_id) agg.operatrice_id = opNote.id;
  if (riga) {
    const cambia = Object.keys(agg).some((k) => {
      if (k === "google_sync_at" || k === "google_event_id") return false;
      if (k === "note") return senzaTag(agg[k]) !== senzaTag(riga[k]);
      return String(agg[k] ?? "") !== String((k === "ora_appuntamento" && riga[k]) ? String(riga[k]).slice(0, 5) : riga[k] ?? "");
    });
    if (!cambia) return "già allineato";
    if (agg.note !== undefined && /creato da Google Calendar$/.test(riga.note || "")) agg.note = [agg.note, "creato da Google Calendar"].filter(Boolean).join(" · ");
    await sb.from("cc_registrazioni").update(agg).eq("id", riga.id);
    return "riga aggiornata #" + riga.id;
  }
  // promemoria dell'ufficio (es. "6-7-7-7 slot Lombardia", "0-1-1", "1-0", "Emilia 0-1-1-1"): non è un appuntamento
  if (isPromemoria(sum)) return "promemoria, non un appuntamento";
  // evento nuovo creato direttamente su Google: diventa un appuntamento preso (senza telefonista, salvo "Telefonista: Nome").
  // Se era già su Google prima del collegamento (GCAL_IMPORTATO_IL) sta solo nel calendario: nelle statistiche c'è già, dai report.
  const tf = campo(desc, "Telefonista"); const op = (tf ? _ops.find((o) => o.nome.toLowerCase().startsWith(tf.toLowerCase().split(" ")[0])) : null) || opNote;
  const creato = ev.created ? locale(ev.created) : { data: new Date().toISOString().slice(0, 10) };
  // stesso appuntamento già registrato nel portale (stessa data e stesso telefono o stesso cliente)? lo collego invece di crearne un altro
  if (agg.data_appuntamento) {
    const cand = (await sb.from("cc_registrazioni").select("*").eq("origine", "portale").eq("data_appuntamento", agg.data_appuntamento).like("tipo_codice", "app_%")).data || [];
    const stesso = cand.find((c: any) => stessoCliente({ telefono: tel, cliente }, c));
    if (stesso) {
      // per quella riga avevamo già creato noi un evento? lo tolgo: vince quello scritto dall'ufficio
      let tolto = false; if (stesso.google_event_id && stesso.google_event_id !== ev.id) tolto = await eliminaNostro(stesso.google_event_id);
      await sb.from("cc_registrazioni").update(unione(stesso, agg)).eq("id", stesso.id);
      return "collegato all'appuntamento del portale #" + stesso.id + (tolto ? " (tolto il nostro doppione su Google)" : "");
    }
  }
  const soloCal = !!IMPORTATO_IL && !!ev.created && new Date(ev.created).getTime() < new Date(IMPORTATO_IL).getTime();
  const ins = { ...agg, origine: "google", tipo_codice: fonteDa(ev), operatrice_id: op?.id || null, data: creato.data, ora: ev.created || new Date().toISOString(), solo_calendario: soloCal,
    note: soloCal ? agg.note || null : [agg.note, "creato da Google Calendar"].filter(Boolean).join(" · ") };
  const { data, error } = await sb.from("cc_registrazioni").insert(ins).select("id").single();
  if (error) throw error;
  return (soloCal ? "importato nel calendario #" : "riga creata #") + data.id;
}
const BUDGET_MS = 20000;   // lavoro per ogni giro del cron: poi salvo il segnalibro di pagina e riprendo al giro dopo
async function pull() {
  const righe = (await sb.from("cc_sync_state").select("k,v").in("k", ["syncToken", "pullPageToken", "pullLock", "pullFinestra"])).data || [];
  const stato: Record<string, string> = Object.fromEntries(righe.map((r: any) => [r.k, r.v]));
  if (stato.pullLock && Date.now() - Number(stato.pullLock) < 55000) return ["pull già in corso"];
  await sb.from("cc_sync_state").upsert({ k: "pullLock", v: String(Date.now()) });
  const esiti: string[] = [], t0 = Date.now();
  let pageToken: string | undefined = stato.pullPageToken || undefined, syncToken: string | undefined = pageToken ? undefined : stato.syncToken;
  // Finestra della lettura completa: da GCAL_IMPORTA_DA a un anno avanti (senza timeMax Google espande i ricorrenti fino al 2040).
  // Va ripetuta IDENTICA a ogni pagina (col solo pageToken Google ignora i filtri), quindi la salvo insieme al segnalibro di pagina.
  let finestra: { timeMin: string; timeMax: string } | null = pageToken && stato.pullFinestra ? JSON.parse(stato.pullFinestra) : null;
  const nuovaFinestra = () => ({ timeMin: /^\d{4}-\d\d-\d\d$/.test(IMPORTA_DA) ? IMPORTA_DA + "T00:00:00Z" : new Date(Date.now() - 60 * 86400000).toISOString(), timeMax: new Date(Date.now() + 366 * 86400000).toISOString() });
  try {
    for (let giro = 0; giro < 50; giro++) {
      const q = new URLSearchParams({ maxResults: "100", showDeleted: "true", singleEvents: "true" });
      if (syncToken) q.set("syncToken", syncToken);
      else { if (!finestra) finestra = nuovaFinestra(); q.set("timeMin", finestra.timeMin); q.set("timeMax", finestra.timeMax); }
      if (pageToken) q.set("pageToken", pageToken);
      let res: any;
      try { res = await gapi("/events?" + q.toString()); }
      catch (e: any) {
        if (e.status === 410 && syncToken) { syncToken = undefined; pageToken = undefined; continue; }            // segnalibro scaduto: lettura completa
        if ((e.status === 400 || e.status === 410) && pageToken) { await sb.from("cc_sync_state").delete().in("k", ["pullPageToken", "pullFinestra"]); pageToken = undefined; syncToken = undefined; finestra = null; continue; }
        throw e;
      }
      const items: any[] = res.items || [];
      // righe già collegate a questi eventi: una query per pagina
      const gids = items.map((ev) => ev.id), ccIds = items.map((ev) => Number(ev.extendedProperties?.private?.cc_id)).filter(Boolean);
      const perGid = new Map<string, any>(), perCc = new Map<number, any>();
      if (gids.length) ((await sb.from("cc_registrazioni").select("*").in("google_event_id", gids)).data || []).forEach((r: any) => perGid.set(r.google_event_id, r));
      if (ccIds.length) ((await sb.from("cc_registrazioni").select("*").in("id", ccIds)).data || []).forEach((r: any) => perCc.set(r.id, r));
      for (const ev of items) {
        const riga = perCc.get(Number(ev.extendedProperties?.private?.cc_id)) || perGid.get(ev.id) || null;
        try { esiti.push(await applica(ev, riga)); } catch (e: any) { esiti.push("errore " + ev.id + ": " + e.message); }
      }
      if (res.nextPageToken) {
        pageToken = res.nextPageToken;
        if (Date.now() - t0 > BUDGET_MS) { await sb.from("cc_sync_state").upsert([{ k: "pullPageToken", v: pageToken }, { k: "pullFinestra", v: JSON.stringify(finestra) }]); esiti.push("continuo al prossimo giro"); return esiti; }
        continue;
      }
      if (res.nextSyncToken) await sb.from("cc_sync_state").upsert({ k: "syncToken", v: res.nextSyncToken });
      await sb.from("cc_sync_state").delete().in("k", ["pullPageToken", "pullFinestra"]);
      break;
    }
    return esiti;
  } finally { await sb.from("cc_sync_state").delete().eq("k", "pullLock"); }
}

Deno.serve(async (req) => {
  try { await config(); } catch (e: any) { return Response.json({ ok: false, errore: "config: " + e.message }, { status: 500 }); }
  if (!HOOK_SECRET || req.headers.get("x-hook-secret") !== HOOK_SECRET) return new Response("no", { status: 401 });
  if (!CAL_ID || !SA.client_email) return Response.json({ ok: false, errore: "manca la configurazione Google (GCAL_SERVICE_ACCOUNT / GCAL_CALENDAR_ID)" }, { status: 503 });
  try {
    await base();
    const url = new URL(req.url);
    if (url.searchParams.get("mode") === "pull") { const esiti = await pull(); return Response.json({ ok: true, esiti }); }
    if (url.searchParams.get("mode") === "ispeziona") {   // una tantum: cosa ha toccato il portale su Google da un certo istante (creati dal service account o con la nostra firma)
      const da = url.searchParams.get("da") || new Date(Date.now() - 6 * 3600000).toISOString();
      const out: any[] = []; let pageToken = "";
      for (let giro = 0; giro < 10; giro++) {
        const q = new URLSearchParams({ updatedMin: da, showDeleted: "true", singleEvents: "true", maxResults: "250" }); if (pageToken) q.set("pageToken", pageToken);
        const res = await gapi("/events?" + q.toString());
        for (const ev of res.items || []) {
          const nostro = (ev.creator?.email || "") === SA.client_email, firma = (ev.description || "").includes("Portale Call Center");
          if (nostro || firma) out.push({ id: ev.id, status: ev.status, summary: ev.summary, start: ev.start?.dateTime || ev.start?.date, end: ev.end?.dateTime || ev.end?.date, creator: ev.creator?.email, updated: ev.updated, created: ev.created, firma, descr: (ev.description || "").slice(0, 160), colorId: ev.colorId });
        }
        if (!res.nextPageToken) break; pageToken = res.nextPageToken;
      }
      return Response.json({ ok: true, da, trovati: out });
    }
    if (url.searchParams.get("mode") === "ripristina_tutti") {   // una tantum: rimette la descrizione originale (= la parte «Note:» che il portale aveva conservato) su tutti gli eventi riscritti
      const da = url.searchParams.get("da") || new Date(Date.now() - 6 * 3600000).toISOString();
      const fatti: any[] = [], errori: any[] = []; let pageToken = "";
      for (let giro = 0; giro < 10; giro++) {
        const q = new URLSearchParams({ updatedMin: da, showDeleted: "true", singleEvents: "true", maxResults: "250" }); if (pageToken) q.set("pageToken", pageToken);
        const res = await gapi("/events?" + q.toString());
        for (const ev of res.items || []) {
          if (ev.status === "cancelled" || !(ev.description || "").includes("— Portale Call Center")) continue;
          const orig = noteDa(ev.description || "") || "";
          try {
            try { await gapi("/events/" + ev.id, "PATCH", { description: orig, colorId: null, extendedProperties: { private: { cc_id: null } } }); }
            catch (_e) { await gapi("/events/" + ev.id, "PATCH", { description: orig }); }
            fatti.push({ id: ev.id, summary: ev.summary, start: ev.start?.dateTime || ev.start?.date });
          } catch (e: any) { errori.push({ id: ev.id, summary: ev.summary, errore: e.message }); }
        }
        if (!res.nextPageToken) break; pageToken = res.nextPageToken;
      }
      return Response.json({ ok: true, ripristinati: fatti.length, fatti, errori });
    }
    if (url.searchParams.get("mode") === "unisci") {      // una tantum: stesso appuntamento nel portale (riga P) e scritto a mano su Google (riga G dal pull): resta P, collegata all'evento dell'ufficio; il nostro doppione su Google viene tolto
      const pid = Number(url.searchParams.get("portale")), gid = Number(url.searchParams.get("google"));
      const P = (await sb.from("cc_registrazioni").select("*").eq("id", pid).single()).data, G = (await sb.from("cc_registrazioni").select("*").eq("id", gid).eq("origine", "google").single()).data;
      if (!P || !G || !G.google_event_id) return Response.json({ ok: false, errore: "righe non trovate" }, { status: 400 });
      if (!stessoCliente(P, G)) return Response.json({ ok: false, errore: "non sembrano lo stesso cliente" }, { status: 400 });
      let tolto = false; if (P.google_event_id && P.google_event_id !== G.google_event_id) tolto = await eliminaNostro(P.google_event_id);
      const u = unione(P, { data_appuntamento: G.data_appuntamento, ora_appuntamento: G.ora_appuntamento, durata_min: G.durata_min, indirizzo: G.indirizzo, zona: G.zona, venditore: G.venditore, cliente: G.cliente, telefono: G.telefono, note: G.note, google_event_id: G.google_event_id, google_sync_at: new Date().toISOString() });
      await sb.from("cc_registrazioni").update(u).eq("id", pid);
      await sb.from("cc_registrazioni").delete().eq("id", gid);
      return Response.json({ ok: true, portale: pid, riga_google_unita: gid, evento_ufficio: G.google_event_id, nostro_evento_tolto: tolto });
    }
    if (url.searchParams.get("mode") === "elimina") {     // una tantum: cancella un evento creato dal portale (solo se il creatore è il service account)
      const gid = url.searchParams.get("gid") || "";
      const ev = await gapi("/events/" + gid);
      if ((ev.creator?.email || "") !== SA.client_email) return Response.json({ ok: false, errore: "non creato dal portale: non si tocca", creator: ev.creator?.email });
      await gapi("/events/" + gid, "DELETE");
      return Response.json({ ok: true, eliminato: { id: gid, summary: ev.summary, start: ev.start?.dateTime || ev.start?.date } });
    }
    if (url.searchParams.get("mode") === "ripristina") {   // una tantum: rimette la descrizione originale (salvata nelle note) e toglie il colore messo dal portale
      const id = Number(url.searchParams.get("id"));
      const riga = (await sb.from("cc_registrazioni").select("*").eq("id", id).maybeSingle()).data;
      if (!riga?.google_event_id) return Response.json({ ok: false, errore: "riga senza evento" });
      const prima = await gapi("/events/" + riga.google_event_id);
      const corpo: any = { description: senzaTag(riga.note) };
      const colore = url.searchParams.get("colore"); if (colore) corpo.colorId = colore;   // il colore non si tocca, salvo richiesta esplicita
      try { await gapi("/events/" + riga.google_event_id, "PATCH", { ...corpo, extendedProperties: { private: { cc_id: null } } }); }
      catch (_e) { await gapi("/events/" + riga.google_event_id, "PATCH", corpo); }
      const dopo = await gapi("/events/" + riga.google_event_id);
      return Response.json({ ok: true, prima: { summary: prima.summary, description: prima.description, colorId: prima.colorId }, dopo: { summary: dopo.summary, description: dopo.description, colorId: dopo.colorId } });
    }
    const body = await req.json().catch(() => ({}));
    const esito = await push(body.type, body.record, body.old_record);
    return Response.json({ ok: true, esito });
  } catch (e: any) { console.error(e); return Response.json({ ok: false, errore: e.message }, { status: 500 }); }
});
