import test from 'node:test';
import assert from 'node:assert/strict';
import { scanCssText } from '../src/cssfilter.js';

const rules = (v) => v.map((x) => x.rule);

test('clean document CSS passes', () => {
  const css = `
    :root { --ink: #15151a; --mono: ui-monospace, Menlo, monospace; }
    body { margin: 0; font-family: var(--mono); }
    .note { border-left: 2px solid var(--ink); position: relative; }
    li::before { content: "—"; position: absolute; }
    @media (max-width: 680px) { body { font-size: 16px; } }
    @media print { body { background: #fff; } }
    @supports (display: grid) { .two { display: grid; } }
  `;
  assert.deepEqual(scanCssText(css), []);
});

test('url() is rejected', () => {
  assert.ok(rules(scanCssText('body { background: url(https://x.example/a.png); }'))
    .includes('css-url-function'));
});

test('url() hidden in a custom property is rejected', () => {
  assert.ok(rules(scanCssText('.x { --leak: url(https://evil.example/p); }'))
    .includes('css-url-function'));
});

test('image-set and src() are rejected', () => {
  assert.ok(rules(scanCssText('.x { background: image-set("a.png" 1x); }')).includes('css-url-function'));
  assert.ok(rules(scanCssText('.x { background: src("a.png"); }')).includes('css-url-function'));
});

test('@import and @font-face are rejected', () => {
  assert.ok(rules(scanCssText('@import "https://fonts.example/x.css";')).includes('css-at-rule'));
  assert.ok(rules(scanCssText('@font-face { font-family: X; src: local(Y); }')).includes('css-at-rule'));
});

test('position: fixed is rejected; absolute and sticky pass', () => {
  assert.ok(rules(scanCssText('.x { position: fixed; }')).includes('css-position-fixed'));
  assert.deepEqual(scanCssText('.x { position: absolute; } .y { position: sticky; }'), []);
});

test('banned constructs inside comments are ignored', () => {
  assert.deepEqual(scanCssText('/* url(https://x) @import */ .x { color: red; }'), []);
});

test('property names containing url-ish substrings do not false-positive', () => {
  assert.deepEqual(scanCssText('.x { text-decoration-line: underline; }'), []);
});
