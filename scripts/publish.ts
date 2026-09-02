import { skel } from '../src/skel';

const LOCAL = Bun.argv.includes('--local');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!LOCAL && (!ACCOUNT || !TOKEN)) throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing');

type Joke = {
  video_id: string; title: string; show: string; t: number;
  mangled_ar: string; mangled_latin: string; meant: string; meant_ar: string;
  summary: string; aliases: string[];
};

const jokesFile = Bun.file('data/jokes.ndjson');
if (!(await jokesFile.exists())) throw new Error('data/jokes.ndjson missing');
const lines = (await jokesFile.text()).split('\n').filter(Boolean);
if (!lines.length) throw new Error('data/jokes.ndjson empty');
const jokes: Joke[] = lines.map(l => JSON.parse(l));

const esc = (s: string | number) => `'${String(s).replaceAll("'", "''")}'`;
const videos = new Map<string, { title: string; show: string }>();
const jokeSql: string[] = [];
const embedTexts: string[] = [];

jokes.forEach((j, i) => {
  const id = i + 1;
  videos.set(j.video_id, { title: j.title, show: j.show ?? '' });
  const skeletons = [...new Set(
    [...j.aliases, j.mangled_ar, j.mangled_latin, j.meant].map(skel).filter(Boolean),
  )].join(' ');
  jokeSql.push(`(${id},${esc(j.video_id)},${j.t},${esc(j.mangled_ar)},${esc(j.mangled_latin)},${esc(j.meant)},${esc(j.meant_ar ?? '')},${esc(j.summary)},${esc(JSON.stringify(j.aliases))},${esc(skeletons)})`);
  embedTexts.push(`${j.mangled_latin} (${j.meant}). ${j.summary}`);
});

const vidSql = [...videos].map(([id, v]) => `(${esc(id)},${esc(v.title)},${esc(v.show)})`);
const batches: string[] = [];
for (let i = 0; i < jokeSql.length; i += 200) {
  batches.push(`INSERT INTO jokes (id, video_id, t, mangled_ar, mangled_latin, meant, meant_ar, summary, aliases, skeletons) VALUES ${jokeSql.slice(i, i + 200).join(',')};`);
}

const seed = [
  'DELETE FROM jokes;',
  'DELETE FROM videos;',
  vidSql.length ? `INSERT INTO videos (id, title, show) VALUES ${vidSql.join(',')};` : '',
  ...batches,
  `INSERT INTO jokes_fts(jokes_fts) VALUES('rebuild');`,
].filter(Boolean).join('\n');
await Bun.write('data/seed.sql', seed);

if (!LOCAL) {
  const vectors: string[] = [];
  for (let i = 0; i < embedTexts.length; i += 50) {
    const chunk = embedTexts.slice(i, i + 50);
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/baai/bge-m3`,
      { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: chunk }) },
    );
    if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json() as { result: { data: number[][] } };
    body.result.data.forEach((values, k) => {
      vectors.push(JSON.stringify({ id: String(i + k + 1), values }));
    });
  }
  await Bun.write('data/vectors.ndjson', vectors.join('\n') + (vectors.length ? '\n' : ''));
}

const flag = LOCAL ? '--local' : '--remote';
// ponytail: full reseed writes ~10 D1 rows/joke; free tier 100k writes/day → at ~5k jokes publish at most once a day; switch to per-video upsert if that bites.
await Bun.$`bunx wrangler d1 execute labsous ${flag} --file data/seed.sql`;
if (!LOCAL) await Bun.$`bunx wrangler vectorize upsert labsous-jokes --file data/vectors.ndjson`;
