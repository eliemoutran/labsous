import { test, expect } from 'bun:test';
import { skel } from '../src/skel';

test('porto klab / porte kleb / arabic collapse', () => {
  expect(skel('porto klab')).toBe('brt klb');
  expect(skel('porte kleb')).toBe('brt klb');
  expect(skel('بورتو كلاب')).toBe('brt klb');
});

test('Umm Sonia / om sonya', () => {
  expect(skel('Umm Sonia')).toBe('m sn');
  expect(skel('om sonya')).toBe('m sn');
});

test('porte-clés', () => {
  expect(skel('porte-clés')).toBe('brt kls');
});

test('arabizi digits and doubles', () => {
  expect(skel('5alas 7abibi')).toBe('xls hb');
});

test('blank', () => {
  expect(skel('   ')).toBe('');
});
