/**
 * Minimal GitHub REST client for the Contents and Git Trees APIs.
 * All calls go through the user's per-person fine-grained PAT.
 *
 * Endpoints used (verified against https://docs.github.com/en/rest):
 *   GET    /repos/{owner}/{repo}/contents/{path}
 *   PUT    /repos/{owner}/{repo}/contents/{path}
 *   DELETE /repos/{owner}/{repo}/contents/{path}
 *   GET    /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1
 *   GET    /repos/{owner}/{repo}/branches/{branch}
 */

const API = 'https://api.github.com';

export interface GHCtx {
  owner: string;
  repo: string;
  token: string;
  branch?: string;
}

export interface GHFile {
  type: 'file';
  encoding: 'base64';
  size: number;
  name: string;
  path: string;
  content: string;
  sha: string;
  download_url: string | null;
}

export interface GHTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url?: string;
}

export interface GHTree {
  sha: string;
  truncated: boolean;
  tree: GHTreeEntry[];
}

export interface GHBranch {
  name: string;
  commit: { sha: string; commit: { tree: { sha: string } } };
}

export class GHError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

/**
 * Default per-request ceiling. Without one, a captive portal that accepts the
 * connection and then never answers leaves the request hanging indefinitely,
 * which stalls the outbox drain behind it.
 */
const REQUEST_TIMEOUT_MS = 15_000;
/** Reachability-shaped calls should give up sooner. */
const PROBE_TIMEOUT_MS = 10_000;
/** Binary transfers get more room than a JSON API call. */
const BLOB_TIMEOUT_MS = 30_000;

/**
 * fetch + an abort deadline, with aborts normalised into `GHError(0)`.
 *
 * Status 0 keeps timeouts inside the GHError family, which callers already
 * treat as "the request failed, stop draining" rather than a bug. A bare
 * DOMException would escape that handling.
 */
async function ghFetch(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new GHError(0, `timeout after ${timeoutMs}ms`);
    }
    throw new GHError(0, err instanceof Error ? err.message : 'network error');
  }
}

function headers(ctx: GHCtx, etag?: string): HeadersInit {
  const h: Record<string, string> = {
    Authorization: `Bearer ${ctx.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (etag) h['If-None-Match'] = etag;
  return h;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new GHError(res.status, `GitHub ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json() as Promise<T>;
}

export async function getBranch(ctx: GHCtx): Promise<GHBranch> {
  const branch = ctx.branch ?? 'main';
  const res = await ghFetch(
    `${API}/repos/${ctx.owner}/${ctx.repo}/branches/${branch}`,
    { headers: headers(ctx) },
    PROBE_TIMEOUT_MS,
  );
  return jsonOrThrow<GHBranch>(res);
}

/**
 * Fetch a tree recursively. Returns null when the ETag indicates no change.
 * The Trees endpoint truncates above ~100k entries / 7MB — well outside our
 * working set, but we expose the flag for callers.
 */
export async function getTreeRecursive(
  ctx: GHCtx,
  treeSha: string,
  etag?: string,
): Promise<{ tree: GHTree; etag: string | null } | null> {
  const res = await ghFetch(
    `${API}/repos/${ctx.owner}/${ctx.repo}/git/trees/${treeSha}?recursive=1`,
    { headers: headers(ctx, etag) },
  );
  if (res.status === 304) return null;
  const tree = await jsonOrThrow<GHTree>(res);
  return { tree, etag: res.headers.get('etag') };
}

export async function getFile(ctx: GHCtx, path: string): Promise<GHFile | null> {
  const branch = ctx.branch ?? 'main';
  const res = await ghFetch(
    `${API}/repos/${ctx.owner}/${ctx.repo}/contents/${encodePath(path)}?ref=${branch}`,
    { headers: headers(ctx) },
  );
  if (res.status === 404) return null;
  return jsonOrThrow<GHFile>(res);
}

export async function getFileText(ctx: GHCtx, path: string): Promise<string | null> {
  const f = await getFile(ctx, path);
  if (!f) return null;
  return new TextDecoder().decode(b64decodeToBytes(f.content));
}

export async function getFileBytes(ctx: GHCtx, path: string): Promise<Uint8Array | null> {
  const f = await getFile(ctx, path);
  if (!f) return null;
  // If the file is large GitHub returns content="" and download_url set.
  if (f.content && f.encoding === 'base64') {
    return b64decodeToBytes(f.content);
  }
  if (f.download_url) {
    // Raw blob download — allow longer than an API call, it's real bytes.
    const r = await ghFetch(
      f.download_url,
      { headers: { Authorization: `Bearer ${ctx.token}` } },
      BLOB_TIMEOUT_MS,
    );
    if (!r.ok) throw new GHError(r.status, `download_url failed`);
    return new Uint8Array(await r.arrayBuffer());
  }
  return null;
}

export async function putFile(
  ctx: GHCtx,
  path: string,
  contentBase64: string,
  commitMessage: string,
  options?: { sha?: string; committerName?: string; committerEmail?: string },
): Promise<{ sha: string }> {
  const branch = ctx.branch ?? 'main';
  const body: Record<string, unknown> = {
    message: commitMessage,
    content: contentBase64,
    branch,
  };
  if (options?.sha) body.sha = options.sha;
  if (options?.committerName && options?.committerEmail) {
    body.committer = { name: options.committerName, email: options.committerEmail };
  }
  const res = await ghFetch(
    `${API}/repos/${ctx.owner}/${ctx.repo}/contents/${encodePath(path)}`,
    {
      method: 'PUT',
      headers: { ...headers(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    BLOB_TIMEOUT_MS,
  );
  const out = await jsonOrThrow<{ content: { sha: string } }>(res);
  return { sha: out.content.sha };
}

export async function deleteFile(
  ctx: GHCtx,
  path: string,
  sha: string,
  commitMessage: string,
): Promise<void> {
  const branch = ctx.branch ?? 'main';
  const res = await ghFetch(`${API}/repos/${ctx.owner}/${ctx.repo}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    headers: { ...headers(ctx), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: commitMessage, sha, branch }),
  });
  await jsonOrThrow<unknown>(res);
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

function b64decodeToBytes(s: string): Uint8Array {
  const cleaned = s.replace(/\s/g, '');
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function textToBase64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}
