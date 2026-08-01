# dizy

*dizy is short for dizygotic. twins, but not identical.*

Visual, aligned, side-by-side diffs of HTML engineering docs in GitHub pull requests.

Reviewing HTML docs on GitHub means reading raw-markup diffs, because GitHub will
never render repository HTML (it would be stored XSS on github.com), and third-party
"htmlpreview" tools pipe your files through shared CORS proxies and execute whatever
they fetch. dizy takes a different deal: docs written in a constrained, script-free
subset of HTML — **diffable HTML** — get a real rendered diff, safely, with nothing
leaving your browser.

## Try it

```sh
npm run serve     # or any static file server — there is no build step
# open http://localhost:8137
```

- **PR mode**: paste a PR URL like `https://github.com/owner/repo/pull/123`. Works
  unauthenticated for public repos (60 requests/hr); add a fine-grained token
  (`Contents: read` + `Pull requests: read`) for 5000/hr and private repos. Tokens
  stay in memory and go only to `api.github.com`.
- **Local mode**: pick two HTML files, zero network. Try
  `fixtures/concept.html` vs `fixtures/concept-after.html`.

The "before" side is fetched at the PR's **merge base** (three-dot semantics, same
as GitHub's own diff view), the "after" side at the head SHA.

## Diffable HTML

The subset is specified in [`spec/diffable-html.html`](spec/diffable-html.html) —
which is written in the subset and validates against itself. Three guarantees:

1. **Inert** — no scripts, handlers, or forms.
2. **Self-contained** — no external references at all: no images, fonts, imports,
   or stylesheets. A doc is one blob at one git ref, rendered identically offline.
3. **Linear** — reading order is DOM order, so a document flattens to a sequence
   of blocks that two versions can be aligned over.

Documents keep their own embedded CSS (typography, layout, print styles) under a
policy: `@media`/`@supports` only, no `url()`-family functions anywhere (including
custom properties), no `position: fixed`.

## How the diff works

Blocks are matched in three phases — exact (LCS over content fingerprints), fuzzy
(token similarity, with `id` as a forced key and heading-level changes tolerated),
then added/removed. Modified blocks get word-level highlights; tables are matched
row-by-row first so an inserted row doesn't smear the rest. Panes render in
`sandbox="allow-same-origin"` srcdoc iframes carrying a `default-src 'none'` CSP —
script execution is impossible by spec and no fetch can leave a pane (verified at
the network level in tests). Spacers inserted at matched blocks keep the two panes
aligned under a single shared scrollbar. Title/meta/CSS changes appear in a separate
"document chrome" panel.

Architecture, including the path to a GitHub-App SaaS with commenting-as-the-user:
[`spec/architecture.html`](spec/architecture.html). Decisions and their evidence
live on the [wayfinder map](https://github.com/kdbanman/dizy/issues/1).

## Development

```sh
npm install       # test-only deps (jsdom)
npm test          # node --test: 51 tests over diff, blocks, validate, cssfilter, github, integration
```

`src/` is dependency-free vanilla ES modules; the whole app deploys as static
files (GitHub Pages works as-is).
