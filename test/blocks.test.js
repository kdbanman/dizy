import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractBlocks, textTokens, blockHash, stampBlocks } from '../src/blocks.js';

const bodyOf = (html) => new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document.body;

test('containers are traversed, leaves collected in order', () => {
  const body = bodyOf(`
    <main>
      <header><h1>Doc</h1><p>Lede</p></header>
      <section id="s1"><h2>One</h2><p>First</p><ul><li>a</li></ul></section>
      <section><table><tr><td>x</td></tr></table></section>
    </main>`);
  const blocks = extractBlocks(body);
  assert.deepEqual(blocks.map((b) => b.tag), ['h1', 'p', 'h2', 'p', 'ul', 'table']);
  assert.ok(blocks[2].path.includes('#s1'));
});

test('container with only inline content is a leaf', () => {
  const body = bodyOf('<div class="note">Just <strong>inline</strong> stuff</div>');
  const blocks = extractBlocks(body);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].tag, 'div');
});

test('tokens split across inline elements stay separate', () => {
  const body = bodyOf('<p>foo<em>bar</em> baz</p>');
  assert.deepEqual(textTokens(body.querySelector('p')), ['foo', 'bar', 'baz']);
});

test('whitespace normalization: reflowed source hashes identically', () => {
  const a = bodyOf('<p>alpha beta   gamma</p>').querySelector('p');
  const b = bodyOf('<p>alpha\n      beta gamma</p>').querySelector('p');
  assert.equal(blockHash(a), blockHash(b));
});

test('attribute change alone changes the hash', () => {
  const a = bodyOf('<p><a href="https://x.example/1">link</a></p>').querySelector('p');
  const b = bodyOf('<p><a href="https://x.example/2">link</a></p>').querySelector('p');
  assert.notEqual(blockHash(a), blockHash(b));
});

test('text change changes the hash', () => {
  const a = bodyOf('<p>one two</p>').querySelector('p');
  const b = bodyOf('<p>one three</p>').querySelector('p');
  assert.notEqual(blockHash(a), blockHash(b));
});

test('stampBlocks writes sequence indices', () => {
  const body = bodyOf('<p>a</p><p>b</p>');
  const blocks = extractBlocks(body);
  stampBlocks(blocks);
  assert.equal(body.children[0].getAttribute('data-dizy-block'), '0');
  assert.equal(body.children[1].getAttribute('data-dizy-block'), '1');
});
