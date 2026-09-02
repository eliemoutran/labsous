import { test, expect } from 'bun:test';
import { sim, ftsQuery, merge, type Row } from '../src/search';

test('sim porto-klab vs porto-klas', () => {
  expect(sim('brtklb', 'brtkls')).toBeGreaterThan(0.8);
});

test('ftsQuery porte kleb', () => {
  const q = ftsQuery('porte kleb')!;
  expect(q).toContain('"porte"');
  expect(q).toContain('"kleb"');
  expect(q).not.toMatch(/"[^"]{1,2}"/);
});

test('ftsQuery claire skips 3-letter skel', () => {
  expect(ftsQuery('claire')!).toBe('"claire"');
});

test('merge moustafa hits Moustafa Colombos', () => {
  const miss: Row = { id: 1, aliases: '["zzzz"]', mangled_latin: 'zzzz', mangled_ar: 'zzzz' };
  const hit: Row = { id: 1956, aliases: '["moustafa colombos","mustafa columbus"]', mangled_latin: 'Moustafa Colombos', mangled_ar: 'مصطفى كولومبوس' };
  expect(merge([miss, hit], [], 'moustafa')[0].id).toBe(1956);
  expect(merge([miss, hit], [], 'columbus')[0].id).toBe(1956);
});

test('merge claire hits eclair over filler', () => {
  const miss: Row = { id: 1, aliases: '["tanki kalar"]', mangled_latin: 'tanki kalar', mangled_ar: 'تانكي كالار' };
  const hit: Row = { id: 2, aliases: '["eclair","claire"]', mangled_latin: 'eclair', mangled_ar: 'إكلير' };
  expect(merge([miss, hit], [], 'claire')[0].id).toBe(2);
});

test('ftsQuery too short', () => {
  expect(ftsQuery('a')).toBeNull();
});

test('merge fuzzy beats higher RRF', () => {
  const high: Row = { id: 1, aliases: '["zzzz"]', mangled_latin: 'zzzz', mangled_ar: 'zzzz' };
  const hit: Row = { id: 2, aliases: '["porto klab"]', mangled_latin: 'porto klab', mangled_ar: 'بورتو كلاب' };
  const out = merge([high], [hit], 'porte kleb');
  expect(out[0].id).toBe(2);
});
