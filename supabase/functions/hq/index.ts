// Minebeat HQ : rassemble les chiffres importants de tous les projets (lecture seule).
// Mot de passe du panneau : secret HQ_PASSWORD. Clé partagée avec Quiet Sense : secret HQ_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sendPush, type Sub, type Vapid } from './push.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const enc = new TextEncoder();
async function same(a: string, b: string) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i]; return d === 0;
}
async function timed<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
const safe = async <T>(f: () => Promise<T>): Promise<T | { error: string }> => {
  try { return await f(); } catch (e) { return { error: String((e as any)?.message || e) }; }
};

// Début de la journée et du mois à l'heure de Tunis (UTC+1)
function tunisStarts() {
  const now = new Date(Date.now() + 3600e3);
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 3600e3;
  const month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 3600e3;
  return { day: new Date(day).toISOString(), week: new Date(day - 6 * 864e5).toISOString(), month: new Date(month).toISOString() };
}

const SITES = [
  { id: 'quiet-sense', name: 'Quiet Sense', url: 'https://quiet-sense.com' },
  { id: 'bjr', name: 'Billie Jean Records', url: 'https://billiejeanrecords.com' },
  { id: 'floriqa', name: 'Floriqa', url: 'https://floriqa.xyz' },
  { id: 'minebeat', name: 'Minebeat Studios', url: 'https://minebeatstudios.com' },
  { id: 'egoshot', name: 'EgoShot (jeu)', url: 'https://hamedkm.github.io/egoshot-play/' },
  { id: 'paradisme', name: 'Paradisme', url: 'https://paradisme.pages.dev' },
  { id: 'voice', name: 'Serveur vocal EgoShot (OVH)', url: 'https://voice.minebeatstudios.com' },
];
const DOMAINS = ['quiet-sense.com', 'billiejeanrecords.com', 'floriqa.xyz', 'minebeatstudios.com', 'minebeat.org'];

async function checkSite(s: typeof SITES[number]) {
  const t = Date.now();
  try {
    const r = await timed(fetch(s.url, { redirect: 'follow', headers: { 'User-Agent': 'MinebeatHQ/1.0' } }), 9000);
    await r.body?.cancel();
    return { ...s, ok: r.status < 500, status: r.status, ms: Date.now() - t };
  } catch (e) {
    return { ...s, ok: false, status: 0, ms: Date.now() - t, error: String((e as any)?.message || e) };
  }
}
async function domainExpiry(d: string) {
  try {
    const r = await timed(fetch('https://rdap.org/domain/' + d, { headers: { Accept: 'application/rdap+json' } }), 8000);
    if (!r.ok) return { domain: d, expires: null };
    const j = await r.json();
    const ev = (j.events || []).find((e: any) => e.eventAction === 'expiration');
    return { domain: d, expires: ev?.eventDate || null };
  } catch { return { domain: d, expires: null }; }
}

async function quietSense() {
  const key = (Deno.env.get('HQ_KEY') || '').trim();
  if (!key) return { error: 'HQ_KEY manquant dans Supabase' };
  const r = await timed(fetch('https://quiet-sense.com/api/hq/summary', { headers: { 'x-hq-key': key } }), 9000);
  if (r.status === 503) return { error: 'HQ_KEY manquant dans Cloudflare' };
  if (r.status === 401) return { error: 'HQ_KEY différent entre Supabase et Cloudflare' };
  if (r.status === 404) return { error: 'Guichet pas encore en ligne sur quiet-sense.com' };
  if (!r.ok) return { error: 'Quiet Sense a répondu ' + r.status };
  return await r.json();
}

async function count(q: any) { const { count, error } = await q; if (error) throw error; return count || 0; }

async function floriqa(db: any, t: ReturnType<typeof tunisStarts>) {
  const head = { count: 'exact', head: true };
  const { data: bk, error } = await db.from('floriqa_bookings').select('id,status,created_at,artist_name,event,city,dates').order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  const by: Record<string, number> = {};
  for (const b of bk || []) by[b.status] = (by[b.status] || 0) + 1;
  return {
    bookings: by,
    bookings_week: (bk || []).filter((b: any) => b.created_at >= t.week).length,
    recent: (bk || []).filter((b: any) => b.status === 'new').slice(0, 5),
    new_ids: (bk || []).filter((b: any) => b.status === 'new').map((b: any) => ({ id: b.id, artist: b.artist_name, event: b.event, city: b.city })),
    access_list: ((await db.from('floriqa_access_requests').select('user_id,display_name').limit(200)).data || []),
    access_requests: await count(db.from('floriqa_access_requests').select('user_id', head)),
    members: await count(db.from('floriqa_members').select('user_id', head)),
    projects: await count(db.from('floriqa_projects').select('id', head)),
    files_week: await count(db.from('floriqa_files').select('id', head).gte('created_at', t.week)),
    comments_week: await count(db.from('floriqa_comments').select('id', head).gte('created_at', t.week)),
  };
}

async function egoshot(db: any, t: ReturnType<typeof tunisStarts>) {
  const head = { count: 'exact', head: true };
  const live = new Date(Date.now() - 10 * 60e3).toISOString();
  const { data: rooms } = await db.from('egoshot_rooms').select('status,players,tv').gte('updated_at', live);
  const { data: ads } = await db.from('egoshot_ad_claims').select('ads').gte('created_at', t.day).limit(100000);
  return {
    players: await count(db.from('egoshot_players').select('id', head)),
    players_today: await count(db.from('egoshot_players').select('id', head).gte('created_at', t.day)),
    banned: await count(db.from('egoshot_players').select('id', head).eq('banned', true)),
    rooms_live: (rooms || []).length,
    playing_now: (rooms || []).filter((r: any) => r.status === 'playing').reduce((s: number, r: any) => s + (r.players || 0), 0),
    in_lobby_now: (rooms || []).filter((r: any) => r.status !== 'playing').reduce((s: number, r: any) => s + (r.players || 0), 0),
    matches_today: await count(db.from('egoshot_matches').select('match_id', head).gte('created_at', t.day)),
    matches_week: await count(db.from('egoshot_matches').select('match_id', head).gte('created_at', t.week)),
    ads_today: (ads || []).reduce((s: number, a: any) => s + (a.ads || 0), 0),
  };
}

async function paradisme(db: any, t: ReturnType<typeof tunisStarts>) {
  const head = { count: 'exact', head: true };
  const recent = new Date(Date.now() - 3 * 3600e3).toISOString();
  return {
    games_today: await count(db.from('rooms').select('id', head).gte('created_at', t.day)),
    games_week: await count(db.from('rooms').select('id', head).gte('created_at', t.week)),
    live_now: await count(db.from('rooms').select('id', head).gte('created_at', recent).not('status', 'in', '(finished,finished_tie)')),
    players_week: await count(db.from('room_players').select('id', head).gte('joined_at', t.week)),
    questions: await count(db.from('questions').select('id', head).eq('is_active', true).is('deleted_at', null)),
    questions_week: await count(db.from('questions').select('id', head).gte('created_at', t.week).is('deleted_at', null)),
  };
}

async function collect(db: any, withDomains: boolean) {
  const t = tunisStarts();
  const [qs, fl, eg, pa, sites, domains, supa] = await Promise.all([
    safe(quietSense),
    safe(() => floriqa(db, t)),
    safe(() => egoshot(db, t)),
    safe(() => paradisme(db, t)),
    Promise.all(SITES.map(checkSite)),
    withDomains ? Promise.all(DOMAINS.map(domainExpiry)) : Promise.resolve([] as any[]),
    safe(async () => { const { data, error } = await db.rpc('hq_db_stats'); if (error) throw error; return data; }),
  ]);
  return {
    ok: true,
    at: new Date().toISOString(),
    projects: { quiet_sense: qs, floriqa: fl, egoshot: eg, paradisme: pa, bjr: { connected: false } },
    sites, domains,
    supabase: { project: 'Paradisme', limits: { db_bytes: 500 * 1024 * 1024, storage_bytes: 1024 * 1024 * 1024 }, ...(supa as any) },
  } as any;
}

const cfg = async (db: any, key: string) => (await db.from('hq_config').select('value').eq('key', key).maybeSingle()).data?.value;
const dt = (m: number) => new Intl.NumberFormat('fr-FR').format(Math.round((m || 0) / 1000)) + ' DT';
const PAY: Record<string, string> = { cod: 'à la livraison', card: 'payée par carte', preorder: 'précommande' };
const HQ = 'https://hq.minebeat.org/';

async function notifyAll(db: any, items: { title: string; body: string; url?: string; tag?: string }[]) {
  if (!items.length) return { sent: 0 };
  const vapid = await cfg(db, 'vapid') as Vapid;
  const { data: subs } = await db.from('hq_push_subs').select('endpoint,p256dh,auth');
  let list = items;
  if (list.length > 5) list = [...items.slice(0, 4), { title: 'Minebeat HQ', body: `+ ${items.length - 4} autres choses à traiter`, url: HQ, tag: 'hq-more' }];
  let sent = 0;
  for (const s of (subs || []) as Sub[]) {
    for (const it of list) {
      try {
        const r = await sendPush(s, { url: HQ, ...it }, vapid);
        if ((r as any).gone) { await db.from('hq_push_subs').delete().eq('endpoint', s.endpoint); break; }
        sent++;
      } catch (e) { console.error('push', String(e)); }
    }
  }
  return { sent };
}

// Compare l'état actuel au précédent et prévient de ce qui est nouveau
async function scan(db: any) {
  const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const prev = (await db.from('hq_state').select('value').eq('key', 'scan').maybeSingle()).data?.value as any;
  const st: any = prev ? structuredClone(prev) : { qs_seen: [], fl_seen: [], acc_seen: [], low_seen: [], down: {}, dom_day: '', dom_alerted: {} };
  const d = await collect(db, st.dom_day !== today);
  const out: { title: string; body: string; url?: string; tag?: string }[] = [];
  const P = d.projects;

  const qs = P.quiet_sense;
  if (!qs.error) {
    const qsFirst = !st.qs_init; st.qs_init = true; // première lecture réussie : on mémorise sans prévenir
    for (const o of [...(qs.recent || [])].reverse()) {
      if (st.qs_seen.includes(o.number)) continue;
      st.qs_seen.push(o.number);
      if (!qsFirst) out.push({ title: '🛍️ Quiet Sense · nouvelle commande', body: `${o.number} · ${o.customer_name || 'client'} · ${dt(o.total)} · ${PAY[o.payment_method] || o.payment_method}`, url: 'https://quiet-sense.com/admin', tag: 'qs-' + o.number });
    }
    st.qs_seen = st.qs_seen.slice(-200);
    const low = (qs.low_stock || []).map((p: any) => p.name);
    const newLow = low.filter((n: string) => !st.low_seen.includes(n));
    if (newLow.length && !qsFirst) out.push({ title: '📦 Quiet Sense · stock bas', body: newLow.slice(0, 3).join(', ') + (newLow.length > 3 ? ` et ${newLow.length - 3} autres` : ''), url: 'https://quiet-sense.com/admin', tag: 'qs-low' });
    st.low_seen = low;
  }
  const fl = P.floriqa;
  if (!fl.error) {
    const flFirst = !st.fl_init; st.fl_init = true;
    for (const b of fl.new_ids || []) {
      if (st.fl_seen.includes(b.id)) continue;
      st.fl_seen.push(b.id);
      if (!flFirst) out.push({ title: '🎤 Floriqa · demande de booking', body: [b.artist, b.event, b.city].filter(Boolean).join(' · '), url: 'https://floriqa.xyz/admin/', tag: 'fl-' + b.id });
    }
    st.fl_seen = st.fl_seen.slice(-300);
    for (const a of fl.access_list || []) {
      if (st.acc_seen.includes(a.user_id)) continue;
      st.acc_seen.push(a.user_id);
      if (!flFirst) out.push({ title: "🔑 Floriqa · demande d'accès à la room", body: a.display_name || 'Nouvel artiste', url: 'https://floriqa.xyz/admin/', tag: 'fl-acc-' + a.user_id });
    }
    st.acc_seen = st.acc_seen.slice(-300);
  }
  for (const s of d.sites) {
    const n = s.ok ? 0 : (st.down[s.id] || 0) + 1;
    if (n === 2) out.push({ title: '🔴 Site hors ligne', body: `${s.name} ne répond plus`, url: HQ, tag: 'down-' + s.id });
    if (n === 0 && (st.down[s.id] || 0) >= 2) out.push({ title: '🟢 Site rétabli', body: `${s.name} répond de nouveau`, url: HQ, tag: 'down-' + s.id });
    st.down[s.id] = n;
  }
  if (st.dom_day !== today && d.domains.length) {
    st.dom_day = today;
    for (const x of d.domains) {
      if (!x.expires) continue;
      const days = Math.floor((new Date(x.expires).getTime() - Date.now()) / 864e5);
      const lvl = days <= 7 ? 7 : days <= 30 ? 30 : 0;
      if (lvl && st.dom_alerted[x.domain] !== lvl) out.push({ title: '🌐 Nom de domaine', body: `${x.domain} expire dans ${days} jours`, url: HQ, tag: 'dom-' + x.domain });
      st.dom_alerted[x.domain] = lvl;
    }
  }
  await db.from('hq_state').upsert({ key: 'scan', value: st, updated_at: new Date().toISOString() });
  const r = await notifyAll(db, out);
  return { events: out.length, ...r };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let body: any; try { body = await req.json(); } catch { return json({ error: 'json' }, 400); }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Vérification automatique chaque minute (lancée par la base elle-même)
  if (body.action === 'scan') {
    const secret = String(await cfg(db, 'cron_secret') || '');
    if (!secret || typeof body.cron !== 'string' || !(await same(body.cron, secret))) return json({ error: 'forbidden' }, 403);
    try { return json({ ok: true, ...(await scan(db)) }); } catch (e) { return json({ error: String((e as any)?.message || e) }, 500); }
  }

  const pw = (Deno.env.get('HQ_PASSWORD') || '').trim();
  if (!pw || pw.length < 8) return json({ error: 'not_configured' }, 503);
  if (typeof body?.password !== 'string' || !(await same(body.password.trim(), pw))) {
    await new Promise((r) => setTimeout(r, 900));
    return json({ error: 'password' }, 401);
  }
  if (body.action === 'check') return json({ ok: true });
  if (body.action === 'subscribe') {
    const s = body.sub || {};
    if (typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'sub' }, 400);
    const { error } = await db.from('hq_push_subs').upsert({ endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, label: String(body.label || '').slice(0, 60) });
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  if (body.action === 'unsubscribe') {
    await db.from('hq_push_subs').delete().eq('endpoint', String(body.endpoint || ''));
    return json({ ok: true });
  }
  if (body.action === 'devices') {
    const { data } = await db.from('hq_push_subs').select('label,created_at').order('created_at');
    return json({ ok: true, devices: data || [] });
  }
  if (body.action === 'test') {
    return json({ ok: true, ...(await notifyAll(db, [{ title: 'Minebeat HQ', body: 'Les notifications fonctionnent ✅', url: HQ, tag: 'hq-test' }])) });
  }
  const d = await collect(db, true);
  for (const k of ['new_ids', 'access_list']) delete (d.projects.floriqa as any)?.[k];
  return json(d);
});
