// dizy 0.1 validator/sanitizer (issue #5). Walks a parsed Document,
// collects violations, and strips non-conformant nodes so the surviving
// tree is safe to serialize into a rendering pane. The renderer refuses
// the rendered view when errors exist — the strip is defense in depth,
// not a license to render junk.

import { scanCssText } from './cssfilter.js';

const CONTAINERS = [
  'main', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'div',
  'blockquote', 'figure', 'details',
];
const LEAF_BLOCKS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'hr', 'ul', 'ol', 'li',
  'dl', 'dt', 'dd', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr',
  'th', 'td', 'figcaption', 'summary',
];
const INLINE = [
  'a', 'span', 'strong', 'em', 'b', 'i', 's', 'u', 'code', 'kbd', 'samp',
  'var', 'mark', 'small', 'sub', 'sup', 'abbr', 'time', 'del', 'ins', 'q',
  'cite', 'dfn', 'br', 'wbr',
];

export const ALLOWED_BODY_TAGS = new Set([...CONTAINERS, ...LEAF_BLOCKS, ...INLINE]);

const GLOBAL_ATTRS = new Set(['id', 'class', 'lang', 'dir', 'title']);
const TAG_ATTRS = {
  a: ['href'],
  th: ['colspan', 'rowspan', 'scope', 'headers'],
  td: ['colspan', 'rowspan', 'scope', 'headers'],
  time: ['datetime'],
  del: ['datetime', 'cite'],
  ins: ['datetime', 'cite'],
  details: ['open'],
  ol: ['start', 'reversed', 'type'],
  li: ['value'],
};

export function parseHtml(text, dom = globalThis) {
  return new dom.DOMParser().parseFromString(text, 'text/html');
}

// Returns { doc, violations, errors } — doc is mutated in place (stripped).
export function validate(doc) {
  const violations = [];
  checkHead(doc, violations);
  if (doc.body) checkBody(doc.body, violations);
  return { doc, violations, errors: violations.filter((v) => v.severity === 'error') };
}

function violation(list, severity, rule, message, node) {
  list.push({ severity, rule, message, where: describe(node) });
}

function describe(node) {
  if (!node || !node.tagName) return 'document';
  const tag = node.tagName.toLowerCase();
  return node.id ? `<${tag} id="${node.id}">` : `<${tag}>`;
}

function checkHead(doc, violations) {
  const head = doc.head;
  if (!head) return;
  if (!head.querySelector('title')) {
    violation(violations, 'error', 'missing-title', 'a <title> is required', head);
  }
  for (const el of [...head.children]) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'title') continue;
    if (tag === 'style') {
      const cssViolations = scanCssText(el.textContent || '', describe(el));
      for (const v of cssViolations) {
        violation(violations, 'error', v.rule, v.message, el);
      }
      continue;
    }
    if (tag === 'meta') {
      const name = (el.getAttribute('name') || '').toLowerCase();
      const isCharset = el.hasAttribute('charset');
      const ok = isCharset || name === 'viewport' || name === 'dizy' || name === 'description';
      if (!ok) {
        violation(violations, 'error', 'disallowed-meta',
          'only charset, viewport, description, and dizy metas are allowed', el);
        el.remove();
      }
      continue;
    }
    violation(violations, 'error', 'disallowed-head-element',
      `<${tag}> is not allowed in <head>`, el);
    el.remove();
  }
}

function checkBody(body, violations) {
  // Snapshot: we mutate as we go.
  const walk = (el) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_BODY_TAGS.has(tag)) {
        violation(violations, 'error', 'disallowed-element',
          `<${tag}> is not in the dizy 0.1 subset`, child);
        child.remove();
        continue;
      }
      checkAttrs(child, tag, violations);
      walk(child);
    }
  };
  checkAttrs(body, 'body', violations);
  walk(body);
}

function checkAttrs(el, tag, violations) {
  const allowed = TAG_ATTRS[tag] || [];
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) {
      violation(violations, 'error', 'event-handler',
        `event handler attribute ${name} is not allowed`, el);
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'style') {
      const cssViolations = scanCssText(attr.value, describe(el));
      for (const v of cssViolations) {
        violation(violations, 'error', v.rule, v.message, el);
        el.removeAttribute(attr.name);
      }
      continue;
    }
    if (name === 'href' && tag === 'a') {
      if (!allowedHref(attr.value)) {
        violation(violations, 'error', 'disallowed-href',
          `href "${attr.value}" — only #fragment, relative, and http(s) links are allowed`, el);
        el.removeAttribute(attr.name);
      }
      continue;
    }
    if (GLOBAL_ATTRS.has(name) || name.startsWith('data-') || allowed.includes(name)) {
      continue;
    }
    violation(violations, 'warning', 'disallowed-attribute',
      `attribute ${name} is not allowed on <${tag}>`, el);
    el.removeAttribute(attr.name);
  }
}

function allowedHref(value) {
  const v = value.trim();
  if (v.startsWith('#')) return true;
  if (/^https?:\/\//i.test(v)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false; // javascript:, data:, etc.
  if (v.startsWith('//')) return false;
  return true; // relative path
}

// Convenience: parse + validate a source string.
export function validateSource(text, dom = globalThis) {
  const doc = parseHtml(text, dom);
  return validate(doc);
}
