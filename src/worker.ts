import { ftsQuery, merge, type Row } from './search';

export interface Env {
  DB: D1Database;
  VEC: VectorizeIndex;
  AI: Ai;
}

const FIELDS = ['id', 'video_id', 'title', 't', 'mangled_ar', 'mangled_latin', 'meant', 'summary'] as const;

function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

const SELECT = `SELECT j.*, v.title FROM jokes j JOIN videos v ON v.id = j.video_id`;
const FTS = `SELECT j.*, v.title, bm25(jokes_fts,10,5,3,1,5) AS r FROM jokes_fts JOIN jokes j ON j.id=jokes_fts.rowid JOIN videos v ON v.id=j.video_id WHERE jokes_fts MATCH ?1 ORDER BY r LIMIT 40`;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/api/search' || req.method !== 'GET') return new Response(null, { status: 404 });
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
    if (!q) return json({ error: 'q required' }, 400);

    const cacheKey = new Request(`${url.origin}${url.pathname}?v=2&q=${encodeURIComponent(q.toLowerCase())}`);
    const hit = await caches.default.match(cacheKey);
    if (hit) return hit;

    const fq = ftsQuery(q);
    let dbErr = false;
    let fts: Row[] = [];
    let vec: Row[] = [];

    await Promise.all([
      (async () => {
        if (!fq) return;
        try {
          const r = await env.DB.prepare(FTS).bind(fq).all<Row>();
          fts = r.results ?? [];
        } catch {
          dbErr = true;
        }
      })(),
      (async () => {
        try {
          const e = await env.AI.run('@cf/baai/bge-m3', { text: [q] }) as { data: number[][] };
          const matches = (await env.VEC.query(e.data[0], { topK: 10 })).matches;
          if (!matches.length) return;
          const ids = matches.map(m => Number(m.id));
          const ph = ids.map(() => '?').join(',');
          const r = await env.DB.prepare(`${SELECT} WHERE j.id IN (${ph})`).bind(...ids).all<Row>();
          const byId = new Map((r.results ?? []).map(row => [row.id, row]));
          vec = ids.map(id => byId.get(id)).filter((x): x is Row => !!x);
        } catch { /* degrade to FTS */ }
      })(),
    ]);

    if (dbErr) return json({ error: 'db' }, 500);

    const results = merge(fts, vec, q).map(row => {
      const o: Record<string, unknown> = {};
      for (const k of FIELDS) o[k] = row[k];
      return o;
    });
    const res = json({ results }, 200, { 'Cache-Control': results.length ? 'public, max-age=86400' : 'no-store' });
    if (results.length) ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
    return res;
  },
} satisfies ExportedHandler<Env>;
