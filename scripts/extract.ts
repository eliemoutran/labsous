import { mkdir } from 'node:fs/promises';

const KEY = process.env.SURPLUS_API_KEY;
if (!KEY) throw new Error('SURPLUS_API_KEY missing');
const MODEL = process.env.SURPLUS_MODEL || 'gemini-3.7-flash';
const NDJSON = process.env.NDJSON || 'data/jokes.ndjson';
const FORCE = Bun.argv.includes('--force');
Bun.argv.includes('--no-refine');

const PROMPT_1 = `You are indexing a Lebanese comedy sketch. The character "Mr. Loughat" (مستر لغات) constantly mispronounces French and English words inside Lebanese Arabic dialogue (e.g. he says "بورتو كلاب" for "porte-clés", or hears "insomnia" as the neighbour "أم سونيا").
List EVERY instance where he mangles a foreign word or misunderstands one. For each:
- t: timestamp MM:SS of the moment the mangled word is first spoken.
- mangled_ar: the mangled word EXACTLY as pronounced, in Arabic script. Do NOT correct it to the real word.
- mangled_latin: the same mangled pronunciation in Latin letters as a Lebanese person would type it (Arabizi), e.g. "porto klab".
- meant: the real word he meant, original language plus English gloss, e.g. "porte-clés (keychain)".
- meant_ar: the real meaning in Arabic, e.g. "ميدالية مفاتيح".
- summary: 1-2 English sentences describing the scene: who is present, where, what he is doing, what the mix-up causes. Name concrete objects and actions so a fan can find it by description.
- aliases: 10-20 alternative Latin spellings fans might type for mangled_ar, varying vowels (o/ou/u, e/i/é, a/e), consonants (p/b, k/q/c, v/f, sh/ch), Arabizi digits (2,3,5,7), spacing and hyphens. Also include the correctly spelled foreign word.
Only real mispronunciations/misunderstandings, not ordinary dialogue. Order by time.`;

const SCHEMA_1 = {
  type: 'object',
  required: ['jokes'],
  properties: {
    jokes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['t', 'mangled_ar', 'mangled_latin', 'meant', 'meant_ar', 'summary', 'aliases'],
        properties: {
          t: { type: 'string' },
          mangled_ar: { type: 'string' },
          mangled_latin: { type: 'string' },
          meant: { type: 'string' },
          meant_ar: { type: 'string' },
          summary: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

type JokeIn = {
  t: string | number;
  mangled_ar: string;
  mangled_latin: string;
  meant: string;
  meant_ar: string;
  summary: string;
  aliases: string[];
};

function videoId(s: string): string | null {
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/)
    ?? (/^[A-Za-z0-9_-]{11}$/.exec(s.trim()));
  return m ? m[1] : null;
}

function parseT(t: string | number): number {
  if (typeof t === 'number') return Math.round(t);
  const p = t.trim().split(':').map(Number);
  if (p.some(n => Number.isNaN(n))) throw new Error(`bad t: ${t}`);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 1) return p[0];
  throw new Error(`bad t: ${t}`);
}

function payload(content: unknown) {
  return {
    model: MODEL,
    messages: [{ role: 'user', content }],
    response_format: { type: 'json_schema', json_schema: { name: 'jokes', schema: SCHEMA_1, strict: true } },
    max_tokens: 32768,
    stream: false,
  };
}

async function post(content: unknown): Promise<{ status: number; body: string }> {
  let attempt = 0;
  while (true) {
    const res = await fetch('https://api.surplusintelligence.ai/min30/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload(content)),
    });
    if (res.status === 429 || res.status === 503) {
      if (++attempt > 5) throw new Error(`surplus ${res.status}`);
      await Bun.sleep(30_000 * attempt);
      continue;
    }
    return { status: res.status, body: await res.text() };
  }
}

async function gemini(prompt: string, ytUrl: string, rawPath?: string): Promise<unknown> {
  const video = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: ytUrl } },
  ];
  let parsed: unknown;
  for (let pass = 0; pass < 2; pass++) {
    const { status, body } = await post(video);
    if (status !== 200) throw new Error(`surplus ${status}: ${body.slice(0, 400)}`);
    const raw = JSON.parse(body);
    if (rawPath) await Bun.write(rawPath, JSON.stringify(raw, null, 2));
    const text = String((raw as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '')
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      parsed = JSON.parse(text);
      break;
    } catch {
      const m = text.match(/"jokes"\s*:\s*\[/);
      if (m) {
        const jokes: JokeIn[] = [];
        const s = text.slice(m.index! + m[0].length);
        let depth = 0, start = -1, inStr = false, esc = false;
        for (let i = 0; i < s.length; i++) {
          const c = s[i];
          if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
          if (c === '"') { inStr = true; continue; }
          if (c === '{') { if (depth === 0) start = i; depth++; }
          else if (c === '}') {
            if (!depth) continue;
            depth--;
            if (depth === 0 && start >= 0) {
              try { const o = JSON.parse(s.slice(start, i + 1)); if (o.mangled_ar) jokes.push(o); } catch { /* truncated object */ }
              start = -1;
            }
          } else if (c === ']' && depth === 0) break;
        }
        if (jokes.length) { parsed = { jokes }; break; }
      }
      if (pass === 1) throw new Error(`surplus json: ${text.slice(0, 200)}`);
    }
  }
  return parsed;
}

async function existingIds(): Promise<Set<string>> {
  try {
    const lines = (await Bun.file(NDJSON).text()).split('\n').filter(Boolean);
    return new Set(lines.map(l => (JSON.parse(l) as { video_id: string }).video_id));
  } catch {
    return new Set();
  }
}

async function dropVideo(id: string) {
  let text = '';
  try { text = await Bun.file(NDJSON).text(); } catch { return; }
  const keep = text.split('\n').filter(l => l && (JSON.parse(l) as { video_id: string }).video_id !== id);
  await Bun.write(NDJSON, keep.length ? keep.join('\n') + '\n' : '');
}

async function readVideos(): Promise<{ url: string; show: string }[]> {
  const args = Bun.argv.slice(2).filter(a => !a.startsWith('--'));
  if (args.length) return args.map(url => ({ url, show: '' }));
  const lines = (await Bun.file(process.env.VIDEOS || 'data/videos.txt').text()).split('\n');
  const out: { url: string; show: string }[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const [url, ...rest] = s.split('|');
    out.push({ url: url.trim(), show: rest.join('|').trim() });
  }
  return out;
}

async function titleOf(id: string): Promise<string> {
  const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
  if (!r.ok) return id;
  return ((await r.json()) as { title: string }).title;
}

async function extractOne(url: string, show: string) {
  const id = videoId(url);
  if (!id) throw new Error(`bad url: ${url}`);
  const have = await existingIds();
  if (have.has(id) && !FORCE) {
    console.log(`skip ${id}`);
    return;
  }
  if (FORCE) await dropVideo(id);

  const title = await titleOf(id);
  const yt = `https://www.youtube.com/watch?v=${id}`;
  await mkdir('data/raw', { recursive: true });

  const pass1 = await gemini(PROMPT_1, yt, `data/raw/${id}.json`) as { jokes: JokeIn[] };
  const rows = [];
  for (const j of pass1.jokes ?? []) {
    const t = parseT(j.t);
    const aliases = [...new Set([j.mangled_latin, ...(j.aliases ?? [])].map(a => a.toLowerCase()))];
    rows.push(JSON.stringify({
      video_id: id, title, show, t,
      mangled_ar: j.mangled_ar, mangled_latin: j.mangled_latin,
      meant: j.meant, meant_ar: j.meant_ar, summary: j.summary, aliases,
    }));
  }
  if (rows.length) await Bun.write(NDJSON, (await Bun.file(NDJSON).exists() ? await Bun.file(NDJSON).text() : '') + rows.join('\n') + '\n');
  console.log(`${id}: ${rows.length} jokes`);
}

const videos = await readVideos();
if (!videos.length) {
  console.error('no videos');
  process.exit(1);
}
let failed = false;
for (const v of videos) {
  try {
    await extractOne(v.url, v.show);
  } catch (e) {
    failed = true;
    console.error(v.url, e);
  }
}
if (failed) process.exit(1);
