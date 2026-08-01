// CSS policy for dizy 0.1 (issue #5). Security is NOT this module's job —
// the pane CSP (default-src 'none') blocks every fetch regardless. This is
// the conformance check that tells authors their doc is inside the subset.
//
// Two layers:
//  - scanCssText: pure string scan, runs anywhere (Node tests, validator CLI).
//  - checkStylesheet: browser-only; canonicalizes through the CSSOM first
//    (constructed CSSStyleSheet.replaceSync), which normalizes escape-based
//    obfuscation like \75 rl( and drops @import outright, then re-scans the
//    serialized output and allowlists rule types.

const BANNED_FUNCTIONS = /(?:^|[^a-z-])(?:url|image-set|image|src|element|-webkit-image-set)\s*\(/i;
const BANNED_AT_RULES = /@(?:import|font-face|namespace|property|layer|keyframes|-\w+-keyframes|charset|page)\b/i;
const FIXED_POSITION = /(?:^|[^-\w])position\s*:\s*fixed\b/i;

export function scanCssText(cssText, where = 'stylesheet') {
  const violations = [];
  const stripped = stripComments(cssText);
  if (BANNED_FUNCTIONS.test(stripped)) {
    violations.push({ rule: 'css-url-function', where,
      message: 'url()/image-set()/image()/src()/element() are not allowed: docs must not reference external or generated resources' });
  }
  if (BANNED_AT_RULES.test(stripped)) {
    violations.push({ rule: 'css-at-rule', where,
      message: 'only @media and @supports at-rules are allowed' });
  }
  if (FIXED_POSITION.test(stripped)) {
    violations.push({ rule: 'css-position-fixed', where,
      message: 'position: fixed escapes document flow and is not allowed' });
  }
  return violations;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const ALLOWED_RULE_TYPES = new Set([
  'CSSStyleRule', 'CSSMediaRule', 'CSSSupportsRule',
]);

// Browser-only. Returns violations; empty array means the stylesheet is
// conformant as canonicalized by this browser.
export function checkStylesheet(cssText, where = 'stylesheet') {
  let sheet;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
  } catch {
    return scanCssText(cssText, where);
  }
  const violations = [];
  const walk = (rules) => {
    for (const rule of rules) {
      const type = rule.constructor.name;
      if (type === 'CSSImportRule') {
        // replaceSync drops @import per spec; belt and braces.
        violations.push({ rule: 'css-at-rule', where, message: '@import is not allowed' });
        continue;
      }
      if (!ALLOWED_RULE_TYPES.has(type)) {
        violations.push({ rule: 'css-rule-type', where,
          message: `${type.replace('CSS', '@').replace('Rule', '').toLowerCase()} rules are not allowed` });
        continue;
      }
      if (rule.cssRules) walk(rule.cssRules);
      if (rule.style) violations.push(...scanCssText(rule.style.cssText, where));
    }
  };
  walk(sheet.cssRules);
  // Also scan raw text: catches banned constructs the parser dropped
  // silently, so authors hear about them instead of shipping dead rules.
  for (const v of scanCssText(cssText, where)) {
    if (!violations.some((w) => w.rule === v.rule)) violations.push(v);
  }
  return violations;
}
