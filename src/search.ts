import { skel, skelKey } from './skel';

export function osa(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
    }
  }
  return d[m][n];
}

export function sim(a: string, b: string): number {
  const n = Math.max(a.length, b.length);
  return n === 0 ? 1 : 1 - osa(a, b) / n;
}

export function ftsQuery(q: string): string | null {
  const raw = q.toLowerCase().match(/[a-z0-9\u0600-\u06ff]+/g) ?? [];
  const sk = skel(q).split(' ').filter(t => t.length >= 4);
  const toks = [...new Set([...raw.filter(t => t.length >= 3), ...sk])];
  return toks.length ? toks.map(t => `"${t}"`).join(' OR ') : null;
}

export type Row = {
  id: number;
  aliases: string;
  mangled_latin: string;
  mangled_ar: string;
  skeletons?: string;
  [k: string]: unknown;
};

export function merge(fts: Row[], vec: Row[], q: string): Omit<Row, 'aliases' | 'skeletons'>[] {
  const score = new Map<number, { row: Row; s: number }>();
  const add = (list: Row[]) => {
    list.forEach((row, i) => {
      const cur = score.get(row.id) ?? { row, s: 0 };
      cur.s += 1 / (60 + i);
      cur.row = row;
      score.set(row.id, cur);
    });
  };
  add(fts);
  add(vec);
  const qk = skelKey(q).slice(0, 40);
  const ql = q.toLowerCase();
  return [...score.values()]
    .map(({ row, s }) => {
      const aliases: string[] = JSON.parse(row.aliases);
      const names = [...aliases, row.mangled_latin, row.mangled_ar, String(row.meant ?? '')];
      const words = names.flatMap(a => a.toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/)).filter(Boolean);
      const f = Math.max(0, ...[...names, ...words].map(a => sim(qk, skelKey(a))));
      const sub = words.some(w => w.includes(ql) || ql.includes(w)) ? 1 : 0;
      return { row, s: s + (f >= 0.7 ? f : 0) + sub };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, 10)
    .map(({ row }) => {
      const { aliases: _a, skeletons: _s, ...rest } = row;
      return rest;
    });
}
