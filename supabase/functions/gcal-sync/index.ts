// Sincronizzazione a doppio senso tra gli appuntamenti del Portale Call Center (cc_registrazioni)
// e un calendario Google condiviso con l'account di servizio.
//
//   portale → Google : chiamata dal trigger del database (webhook) a ogni insert/update/delete di un appuntamento
//   Google → portale : chiamata dal cron ogni 2 minuti (?mode=pull), con syncToken incrementale
//
// Variabili d'ambiente (supabase secrets): GCAL_SERVICE_ACCOUNT (json della chiave), GCAL_CALENDAR_ID,
// GCAL_HOOK_SECRET (deve coincidere con l'header x-hook-secret), GCAL_FONTE_DEFAULT (es. app_cc).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const TZ = "Europe/Rome";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
// Configurazione: dalle variabili d'ambiente oppure dalla tabella cc_sync_state (protetta da RLS, la legge solo la chiave di servizio)
let SA: any = {}, CAL_ID = "", HOOK_SECRET = "", FONTE_DEFAULT = "app_cc", _cfgAt = 0;
async function config() {
  if (Date.now() - _cfgAt < 60000 && HOOK_SECRET) return;
  const righe = (await sb.from("cc_sync_state").select("k,v")).data || [];
  const cfg = (k: string) => Deno.env.get(k) || righe.find((r: any) => r.k === k)?.v || "";
  SA = JSON.parse(cfg("GCAL_SERVICE_ACCOUNT") || "{}"); CAL_ID = cfg("GCAL_CALENDAR_ID"); HOOK_SECRET = cfg("GCAL_HOOK_SECRET"); FONTE_DEFAULT = cfg("GCAL_FONTE_DEFAULT") || "app_cc";
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
const COLORI: Record<string, string> = { blue: "9", amber: "6", indigo: "3", green: "10", purple: "3", red: "11", pink: "4", gray: "8" };

// ── data/ora ──
function addMin(data: string, ora: string, min: number) {
  const [y, m, d] = data.split("-").map(Number), [hh, mm] = ora.split(":").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm) + min * 60000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}T${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}:00`;
}
function addDays(data: string, n: number) { const [y, m, d] = data.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
// Parte locale (Europe/Rome) di un dateTime Google, qualunque offset abbia
function locale(dt: string) {
  const d = new Date(dt);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (k: string) => p.find((x) => x.type === k)?.value;
  return { data: `${g("year")}-${g("month")}-${g("day")}`, ora: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}` };
}

// ── portale → Google: come deve apparire l'evento ──
function eventoDa(r: any) {
  const t = tipoDi(r.tipo_codice), op = opDi(r.operatrice_id);
  const fonte = t?.fonte || t?.nome || "";
  const demo = r.demo === "fatta" ? "fatta" + (r.demo_data ? " il " + r.demo_data.split("-").reverse().join("/") : "") : r.demo === "non_fatta" ? "non fatta" : "da fare";
  const desc = [
    r.telefono ? "Telefono: " + r.telefono : "", "Fonte: " + fonte, "Telefonista: " + (op?.nome || "nessuna"),
    r.venditore ? "Venditore: " + r.venditore : "", "Demo: " + demo, r.note ? "Note: " + r.note : "",
    "", "— Portale Call Center #" + r.id,
  ].filter((x) => x !== "").join("\n");
  const ev: any = {
    summary: `${r.cliente || "Cliente non indicato"} · ${fonte}${op ? " · " + op.nome.split(" ")[0] : ""}`,
    location: r.indirizzo || "", description: desc, colorId: COLORI[t?.colore || "blue"] || "9",
    extendedProperties: { private: { cc_id: String(r.id) } },
  };
  if (r.ora_appuntamento) {
    const ora = String(r.ora_appuntamento).slice(0, 5);
    ev.start = { dateTime: `${r.data_appuntamento}T${ora}:00`, timeZone: TZ };
    ev.end = { dateTime: addMin(r.data_appuntamento, ora, r.durata_min || 60), timeZone: TZ };
  } else { ev.start = { date: r.data_appuntamento }; ev.end = { date: addDays(r.data_appuntamento, 1) }; }
  return ev;
}
const uguale = (a: any, b: any) => ["summary", "location", "description"].every((k) => (a[k] || "") === (b[k] || "")) &&
  JSON.stringify(a.start) === JSON.stringify(b.start) && JSON.stringify(a.end) === JSON.stringify(b.end);

async function push(tipo: string, record: any, old: any) {
  const r = record || old;
  if (!r || !isApp(r.tipo_codice) && !(old && isApp(old.tipo_codice))) return "non è un appuntamento";
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
      if (uguale(esistente, voluto)) return "già allineato";
      await gapi("/events/" + record.google_event_id, "PATCH", voluto);
      await sb.from("cc_registrazioni").update({ google_sync_at: new Date().toISOString() }).eq("id", record.id);
      return "evento aggiornato";
    }
  }
  const creato = await gapi("/events", "POST", voluto);
  await sb.from("cc_registrazioni").update({ google_event_id: creato.id, google_sync_at: new Date().toISOString() }).eq("id", record.id);
  return "evento creato " + creato.id;
}

// ── Google → portale ──
function fonteDa(ev: any): string {
  const testo = (ev.summary || "") + " " + (ev.description || "");
  const m = testo.match(/Fonte:\s*([^\n]+)/i);
  const nome = (m ? m[1] : (ev.summary || "").split(" · ")[1] || "").trim().toLowerCase();
  const t = _tipi.find((x) => x.gruppo === "appuntamenti" && (x.fonte || x.nome).toLowerCase() === nome) ||
    _tipi.find((x) => x.gruppo === "appuntamenti" && nome && (x.fonte || "").toLowerCase().startsWith(nome.slice(0, 3)));
  return t?.codice || FONTE_DEFAULT;
}
function campo(desc: string, k: string) { const m = (desc || "").match(new RegExp("^" + k + ":\\s*(.*)$", "mi")); return m ? m[1].trim() : null; }
async function applica(ev: any) {
  const ccId = Number(ev.extendedProperties?.private?.cc_id) || null;
  let riga: any = null;
  if (ccId) riga = (await sb.from("cc_registrazioni").select("*").eq("id", ccId).maybeSingle()).data;
  if (!riga) riga = (await sb.from("cc_registrazioni").select("*").eq("google_event_id", ev.id).maybeSingle()).data;
  if (ev.status === "cancelled") {
    // cancellato su Google: lo tolgo dal calendario del portale ma l'appuntamento preso resta nelle statistiche
    if (riga && riga.data_appuntamento) await sb.from("cc_registrazioni").update({ data_appuntamento: null, ora_appuntamento: null, google_event_id: null, note: [riga.note, "tolto dal calendario Google"].filter(Boolean).join(" · ") }).eq("id", riga.id);
    return riga ? "tolto dal calendario" : "ignorato";
  }
  const tuttoIlGiorno = !!ev.start?.date;
  const inizio = tuttoIlGiorno ? { data: ev.start.date, ora: null } : locale(ev.start.dateTime);
  const fine = tuttoIlGiorno ? null : locale(ev.end.dateTime);
  const durata = fine ? Math.max(15, Math.round((new Date(ev.end.dateTime).getTime() - new Date(ev.start.dateTime).getTime()) / 60000)) : (riga?.durata_min || 60);
  const desc = ev.description || "";
  const cliente = (ev.summary || "").split(" · ")[0].trim() || null;
  const agg: any = { data_appuntamento: inizio.data, ora_appuntamento: inizio.ora, durata_min: durata, indirizzo: ev.location || null, google_event_id: ev.id, google_sync_at: new Date().toISOString() };
  if (cliente && cliente !== "Cliente non indicato") agg.cliente = cliente;
  const tel = campo(desc, "Telefono"), ven = campo(desc, "Venditore"), note = campo(desc, "Note");
  if (tel !== null) agg.telefono = tel || null;
  if (ven !== null) agg.venditore = ven || null;
  if (note !== null) agg.note = note || null;
  if (riga) {
    const cambia = Object.keys(agg).some((k) => k !== "google_sync_at" && k !== "google_event_id" && String(agg[k] ?? "") !== String((k === "ora_appuntamento" && riga[k]) ? String(riga[k]).slice(0, 5) : riga[k] ?? ""));
    if (!cambia) return "già allineato";
    await sb.from("cc_registrazioni").update(agg).eq("id", riga.id);
    return "riga aggiornata #" + riga.id;
  }
  // evento nuovo creato direttamente su Google: diventa un appuntamento preso (senza telefonista, salvo "Telefonista: Nome")
  const tf = campo(desc, "Telefonista"); const op = tf ? _ops.find((o) => o.nome.toLowerCase().startsWith(tf.toLowerCase().split(" ")[0])) : null;
  const creato = ev.created ? locale(ev.created) : { data: new Date().toISOString().slice(0, 10) };
  const ins = { ...agg, tipo_codice: fonteDa(ev), operatrice_id: op?.id || null, data: creato.data, ora: ev.created || new Date().toISOString(), note: [agg.note, "creato da Google Calendar"].filter(Boolean).join(" · ") };
  const { data, error } = await sb.from("cc_registrazioni").insert(ins).select("id").single();
  if (error) throw error;
  return "riga creata #" + data.id;
}
async function pull() {
  const st = (await sb.from("cc_sync_state").select("v").eq("k", "syncToken").maybeSingle()).data?.v;
  const esiti: string[] = [];
  let pageToken: string | undefined, syncToken = st;
  for (let giro = 0; giro < 20; giro++) {
    const q = new URLSearchParams({ maxResults: "250", showDeleted: "true", singleEvents: "true" });
    if (pageToken) q.set("pageToken", pageToken);
    else if (syncToken) q.set("syncToken", syncToken);
    else { const da = new Date(Date.now() - 60 * 86400000).toISOString(); q.set("timeMin", da); }
    let res: any;
    try { res = await gapi("/events?" + q.toString()); }
    catch (e: any) { if (e.status === 410 && syncToken) { syncToken = undefined; pageToken = undefined; continue; } throw e; }
    for (const ev of res.items || []) { try { esiti.push(await applica(ev)); } catch (e: any) { esiti.push("errore " + ev.id + ": " + e.message); } }
    if (res.nextPageToken) { pageToken = res.nextPageToken; continue; }
    if (res.nextSyncToken) await sb.from("cc_sync_state").upsert({ k: "syncToken", v: res.nextSyncToken });
    break;
  }
  return esiti;
}

Deno.serve(async (req) => {
  try { await config(); } catch (e: any) { return Response.json({ ok: false, errore: "config: " + e.message }, { status: 500 }); }
  if (!HOOK_SECRET || req.headers.get("x-hook-secret") !== HOOK_SECRET) return new Response("no", { status: 401 });
  if (!CAL_ID || !SA.client_email) return Response.json({ ok: false, errore: "manca la configurazione Google (GCAL_SERVICE_ACCOUNT / GCAL_CALENDAR_ID)" }, { status: 503 });
  try {
    await base();
    const url = new URL(req.url);
    if (url.searchParams.get("mode") === "pull") { const esiti = await pull(); return Response.json({ ok: true, esiti }); }
    const body = await req.json().catch(() => ({}));
    const esito = await push(body.type, body.record, body.old_record);
    return Response.json({ ok: true, esito });
  } catch (e: any) { console.error(e); return Response.json({ ok: false, errore: e.message }, { status: 500 }); }
});
