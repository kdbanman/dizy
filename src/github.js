// GitHub REST access from the browser. api.github.com is CORS-open
// (Access-Control-Allow-Origin: * including the Authorization header),
// so everything here runs client-side with no proxy.

const API = 'https://api.github.com';

export function parsePrUrl(input) {
  const m = String(input).trim().match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/
  );
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export class GhClient {
  constructor(token) {
    this.token = token || null;
    this.rateLimit = { limit: null, remaining: null, reset: null };
  }

  async #request(url, accept) {
    const headers = {
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(url, { headers });
    const limit = res.headers.get('x-ratelimit-limit');
    if (limit !== null) {
      this.rateLimit = {
        limit: Number(limit),
        remaining: Number(res.headers.get('x-ratelimit-remaining')),
        reset: Number(res.headers.get('x-ratelimit-reset')),
      };
    }
    if (!res.ok) {
      const err = new Error(`GitHub API ${res.status} for ${url}`);
      err.status = res.status;
      err.rateLimited = res.status === 403 && this.rateLimit.remaining === 0;
      try { err.detail = (await res.json()).message; } catch { /* body not JSON */ }
      throw err;
    }
    return res;
  }

  async json(url) {
    return (await this.#request(url)).json();
  }

  async getPr({ owner, repo, number }) {
    return this.json(`${API}/repos/${owner}/${repo}/pulls/${number}`);
  }

  // GitHub PR diffs are three-dot: head vs merge base, not vs the base
  // branch tip. base.sha may have advanced past the fork point, so the
  // faithful "before" ref comes from the compare API.
  async getMergeBaseSha(pr) {
    const { owner, repo } = splitRepo(pr.base.repo.full_name);
    const cmp = await this.json(
      `${API}/repos/${owner}/${repo}/compare/${pr.base.sha}...${pr.head.sha}`
    );
    return cmp.merge_base_commit.sha;
  }

  async listFiles(pr) {
    const { owner, repo } = splitRepo(pr.base.repo.full_name);
    const files = [];
    for (let page = 1; page <= 30; page++) {
      const batch = await this.json(
        `${API}/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100&page=${page}`
      );
      files.push(...batch);
      if (batch.length < 100) break;
    }
    return files;
  }

  // Raw media type handles files 1–100 MB that the default JSON type 403s on.
  async getFileText(repoFullName, path, ref) {
    const { owner, repo } = splitRepo(repoFullName);
    const url = `${API}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${ref}`;
    const res = await this.#request(url, 'application/vnd.github.raw+json');
    return res.text();
  }
}

export function splitRepo(fullName) {
  const [owner, repo] = fullName.split('/');
  return { owner, repo };
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function isHtmlPath(path) {
  return /\.x?html?$/i.test(path);
}

// Assembles the per-file before/after pair from a PR's file entry.
// Renames read the old content at previous_filename.
export async function fetchPair(client, pr, mergeBaseSha, file) {
  const baseRepo = pr.base.repo.full_name;
  const headRepo = pr.head.repo ? pr.head.repo.full_name : baseRepo;
  const oldPath = file.previous_filename || file.filename;
  const before = file.status === 'added'
    ? null
    : await client.getFileText(baseRepo, oldPath, mergeBaseSha);
  const after = file.status === 'removed'
    ? null
    : await client.getFileText(headRepo, file.filename, pr.head.sha);
  return { before, after };
}
