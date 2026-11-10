import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, hm, hours, esc, parseDuration, toCsv, dayKey, timeKey } from '../public/js/format.js';

test('clock / hm / hours', () => {
  assert.equal(clock(0), '0:00:00');
  assert.equal(clock(3725000), '1:02:05');
  assert.equal(clock(-5000), '0:00:00');
  assert.equal(clock(26 * 3600000), '26:00:00');
  assert.equal(hm(3725000), '1h 02m');
  assert.equal(hours(5400000), '1.50');
});

test('esc escapes HTML', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('parseDuration', () => {
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration('0:05'), 5);
  assert.equal(parseDuration('2'), 120);
  assert.equal(parseDuration(' 1:00 '), 60);
  assert.equal(parseDuration('1:75'), null);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration(''), null);
});

test('toCsv quotes everything and escapes quotes', () => {
  assert.equal(toCsv([['a', 'b "c"'], [1, null]]), '"a","b ""c"""\r\n"1",""');
});

test('dayKey / timeKey use local time', () => {
  const t = new Date(2026, 0, 5, 7, 3).getTime();
  assert.equal(dayKey(t), '2026-01-05');
  assert.equal(timeKey(t), '07:03');
});
