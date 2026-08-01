import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrUrl, isHtmlPath, splitRepo } from '../src/github.js';

test('parses canonical PR URLs', () => {
  assert.deepEqual(parsePrUrl('https://github.com/kdbanman/stint/pull/42'),
    { owner: 'kdbanman', repo: 'stint', number: 42 });
});

test('tolerates missing scheme, www, and trailing paths', () => {
  assert.deepEqual(parsePrUrl('github.com/a/b/pull/7'), { owner: 'a', repo: 'b', number: 7 });
  assert.deepEqual(parsePrUrl('https://www.github.com/a/b/pull/7/files'),
    { owner: 'a', repo: 'b', number: 7 });
});

test('rejects non-PR URLs', () => {
  assert.equal(parsePrUrl('https://github.com/a/b'), null);
  assert.equal(parsePrUrl('https://github.com/a/b/issues/3'), null);
  assert.equal(parsePrUrl('https://gitlab.com/a/b/pull/3'), null);
});

test('isHtmlPath matches html variants only', () => {
  assert.ok(isHtmlPath('context/prd.html'));
  assert.ok(isHtmlPath('doc.htm'));
  assert.ok(isHtmlPath('doc.xhtml'));
  assert.ok(!isHtmlPath('doc.md'));
  assert.ok(!isHtmlPath('html/doc.css'));
});

test('splitRepo splits full names', () => {
  assert.deepEqual(splitRepo('kdbanman/dizy'), { owner: 'kdbanman', repo: 'dizy' });
});
