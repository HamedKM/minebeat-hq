// Minebeat HQ : rassemble les chiffres importants de tous les projets (lecture seule).
// Mot de passe du panneau : secret HQ_PASSWORD. Clé partagée avec Quiet Sense : secret HQ_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const secret = (Deno.env.get('HQ_PASSWORD') || '').trim();
  let body: any; try { body = await req.json(); } catch { return json({ error: 'json' }, 400); }
  if (!secret || secret.length < 8) return json({ error: 'not_configured' }, 503);
  if (typeof body?.password !== 'string' || !(await same(body.password.trim(), secret))) {
    await new Promise((r) => setTimeout(r, 900));
    return json({ error: 'password' }, 401);
  }
  if (body.action === 'check') return json({ ok: true });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t = tunisStarts();
  const [qs, fl, eg, pa, sites, domains, supa] = await Promise.all([
    safe(quietSense),
    safe(() => floriqa(db, t)),
    safe(() => egoshot(db, t)),
    safe(() => paradisme(db, t)),
    Promise.all(SITES.map(checkSite)),
    Promise.all(DOMAINS.map(domainExpiry)),
    safe(async () => { const { data, error } = await db.rpc('hq_db_stats'); if (error) throw error; return data; }),
  ]);
  return json({
    ok: true,
    at: new Date().toISOString(),
    projects: { quiet_sense: qs, floriqa: fl, egoshot: eg, paradisme: pa, bjr: { connected: false } },
    sites, domains,
    supabase: { project: 'Paradisme', limits: { db_bytes: 500 * 1024 * 1024, storage_bytes: 1024 * 1024 * 1024 }, ...(supa as any) },
  });
});
