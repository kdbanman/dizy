import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { validateSource } from '../src/validate.js';

const dom = new JSDOM().window;
const doc = (head, body) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>t</title>${head}</head><body>${body}</body></html>`;

const rules = (r) => r.violations.map((v) => v.rule);

test('conformant doc passes clean', () => {
  const r = validateSource(doc(
    '<style>p { color: #333; } @media print { body { background: #fff; } }</style>',
    '<main><h1>Title</h1><p>Hello <strong>world</strong></p><table><tr><td>x</td></tr></table></main>'
  ), dom);
  assert.deepEqual(r.violations, []);
});

test('script elements are rejected and stripped', () => {
  const r = validateSource(doc('', '<p>ok</p><script>alert(1)</script>'), dom);
  assert.ok(rules(r).includes('disallowed-element'));
  assert.equal(r.doc.querySelector('script'), null);
});

test('img, svg, iframe, form are rejected', () => {
  const r = validateSource(doc('', '<img src="x.png"><svg></svg><iframe></iframe><form></form>'), dom);
  assert.equal(rules(r).filter((x) => x === 'disallowed-element').length, 4);
});

test('event handler attributes are rejected and stripped', () => {
  const r = validateSource(doc('', '<p onclick="alert(1)">hi</p>'), dom);
  assert.ok(rules(r).includes('event-handler'));
  assert.equal(r.doc.querySelector('p').attributes.length, 0);
});

test('url() in style attribute is an error', () => {
  const r = validateSource(doc('', '<p style="background:url(https://evil.example/x)">hi</p>'), dom);
  assert.ok(rules(r).includes('css-url-function'));
  assert.equal(r.doc.querySelector('p').getAttribute('style'), null);
});

test('clean style attribute is kept', () => {
  const r = validateSource(doc('', '<p style="margin-top:2em">hi</p>'), dom);
  assert.deepEqual(r.violations, []);
  assert.equal(r.doc.querySelector('p').getAttribute('style'), 'margin-top:2em');
});

test('head style with @import is an error', () => {
  const r = validateSource(doc('<style>@import "https://fonts.example/x.css";</style>', '<p>x</p>'), dom);
  assert.ok(rules(r).includes('css-at-rule'));
});

test('missing title is an error', () => {
  const r = validateSource('<!DOCTYPE html><html><head></head><body><p>x</p></body></html>', dom);
  assert.ok(rules(r).includes('missing-title'));
});

test('meta refresh is rejected', () => {
  const r = validateSource(doc('<meta http-equiv="refresh" content="0;url=https://x">', '<p>x</p>'), dom);
  assert.ok(rules(r).includes('disallowed-meta'));
});

test('link elements in head are rejected', () => {
  const r = validateSource(doc('<link rel="stylesheet" href="x.css">', '<p>x</p>'), dom);
  assert.ok(rules(r).includes('disallowed-head-element'));
});

test('javascript: and data: hrefs are rejected, fragment/relative/https kept', () => {
  const r = validateSource(doc('',
    '<p><a href="javascript:alert(1)">a</a><a href="data:text/html,x">b</a>' +
    '<a href="#frag">c</a><a href="other.html">d</a><a href="https://example.com">e</a></p>'), dom);
  assert.equal(rules(r).filter((x) => x === 'disallowed-href').length, 2);
  const hrefs = [...r.doc.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, [null, null, '#frag', 'other.html', 'https://example.com']);
});

test('unknown attributes are stripped as warnings, data-* kept', () => {
  const r = validateSource(doc('', '<table><tr><td data-l="Label" width="40">x</td></tr></table>'), dom);
  const warn = r.violations.find((v) => v.rule === 'disallowed-attribute');
  assert.ok(warn);
  assert.equal(warn.severity, 'warning');
  assert.equal(r.errors.length, 0);
});

test('dizy conformance meta is allowed', () => {
  const r = validateSource(doc('<meta name="dizy" content="0.1">', '<p>x</p>'), dom);
  assert.deepEqual(r.violations, []);
});
