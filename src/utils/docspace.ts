const BASE = (process.env.DOCSPACE_BASE_URL ?? '').replace(/\/+$/, '');
const API_KEY = process.env.DOCSPACE_API_KEY ?? '';
const FOLDER_ID = process.env.DOCSPACE_TRANSCRIPTS_FOLDER_ID ?? '';

export function isDocSpaceConfigured(): boolean {
  return Boolean(BASE && API_KEY && FOLDER_ID);
}

export interface DocSpaceUpload {
  fileId: number;
  /** Internal viewer URL — requires DocSpace login + room access (staff only). */
  webUrl: string;
}

export interface DocSpaceFolder {
  folderId: number;
  webUrl: string;
  /** true when this call created the folder; false when it already existed. */
  created: boolean;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}` };
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms = 20000): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(t);
  }
}

// Retries an operation that signals failure by resolving to null (e.g. a timed-out
// or 5xx upload). Linear backoff; DocSpace blips during a close shouldn't lose a
// transcript. Operations here are idempotent (createNewIfExist / find-or-create).
async function withRetry<T>(label: string, fn: () => Promise<T | null>, attempts = 3): Promise<T | null> {
  for (let i = 1; i <= attempts; i++) {
    const res = await fn();
    if (res !== null) return res;
    if (i < attempts) {
      const backoff = 500 * i;
      console.warn(`[docspace] ${label} attempt ${i}/${attempts} failed — retrying in ${backoff}ms`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  console.error(`[docspace] ${label} failed after ${attempts} attempts`);
  return null;
}

const folderUrl = (id: number) => `${BASE}/rooms/shared/${id}/filter?folder=${id}`;

/** Finds a subfolder by title under a parent folder, creating it if missing. */
export async function ensureSubfolder(parentId: number | string, title: string): Promise<DocSpaceFolder | null> {
  if (!isDocSpaceConfigured()) return null;
  return withRetry(`ensureSubfolder(${title})`, () => ensureSubfolderOnce(parentId, title));
}

async function ensureSubfolderOnce(parentId: number | string, title: string): Promise<DocSpaceFolder | null> {
  try {
    const list = await withTimeout(signal =>
      fetch(`${BASE}/api/2.0/files/${parentId}`, { headers: authHeaders(), signal })
    );
    if (list.ok) {
      const data = (await list.json()) as { response?: { folders?: Array<{ id: number; title: string; webUrl?: string }> } };
      const existing = data.response?.folders?.find(f => f.title === title);
      if (existing) return { folderId: existing.id, webUrl: existing.webUrl ?? folderUrl(existing.id), created: false };
    }
    const created = await withTimeout(signal =>
      fetch(`${BASE}/api/2.0/files/folder/${parentId}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
        signal,
      })
    );
    if (!created.ok) { console.error(`[docspace] subfolder create failed: HTTP ${created.status}`); return null; }
    const d = (await created.json()) as { response?: { id?: number; webUrl?: string } };
    if (!d.response?.id) return null;
    return { folderId: d.response.id, webUrl: d.response.webUrl ?? folderUrl(d.response.id), created: true };
  } catch (err) {
    console.error('[docspace] ensureSubfolder error:', err);
    return null;
  }
}

/** Find-or-create a folder directly under the configured transcripts room. */
export async function ensureRootFolder(title: string): Promise<DocSpaceFolder | null> {
  return ensureSubfolder(FOLDER_ID, title);
}

/** Uploads an in-memory buffer as a file into a specific folder. */
export async function uploadBufferToFolder(
  folderId: number,
  filename: string,
  buffer: Buffer | Uint8Array,
  mime: string
): Promise<DocSpaceUpload | null> {
  if (!isDocSpaceConfigured()) return null;
  return withRetry(`upload(${filename})`, () => uploadBufferOnce(folderId, filename, buffer, mime));
}

async function uploadBufferOnce(
  folderId: number,
  filename: string,
  buffer: Buffer | Uint8Array,
  mime: string
): Promise<DocSpaceUpload | null> {
  try {
    const form = new FormData();
    form.append('title', filename);
    form.append('createNewIfExist', 'true');
    form.append('file', new Blob([buffer], { type: mime }), filename);

    const res = await withTimeout(signal =>
      fetch(`${BASE}/api/2.0/files/${folderId}/insert`, { method: 'POST', headers: authHeaders(), body: form, signal })
    );
    if (!res.ok) { console.error(`[docspace] file upload failed: HTTP ${res.status}`); return null; }
    const data = (await res.json()) as { response?: { id?: number; webUrl?: string } };
    const r = data.response;
    if (!r?.id) return null;
    return { fileId: r.id, webUrl: r.webUrl ?? `${BASE}/doceditor?fileid=${r.id}&action=view` };
  } catch (err) {
    console.error('[docspace] file upload error:', err);
    return null;
  }
}

/** Downloads a (Discord CDN) URL and uploads it into a folder. Skips files > maxBytes. */
const DISCORD_CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

export async function uploadUrlToFolder(
  folderId: number,
  url: string,
  filename: string,
  maxBytes = 25 * 1024 * 1024
): Promise<boolean> {
  if (!isDocSpaceConfigured()) return false;

  // SSRF guard: only ever fetch attachments from Discord's CDN over HTTPS.
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' || !DISCORD_CDN_HOSTS.has(parsed.hostname)) {
    console.warn(`[docspace] refusing non-Discord attachment URL: ${parsed.hostname}`);
    return false;
  }

  try {
    const res = await withTimeout(signal => fetch(url, { signal }), 30000);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      console.warn(`[docspace] skipping attachment ${filename} (${buf.length} bytes > limit)`);
      return false;
    }
    const mime = res.headers.get('content-type') ?? 'application/octet-stream';
    const up = await uploadBufferToFolder(folderId, filename, buf, mime);
    return !!up;
  } catch (err) {
    console.error('[docspace] attachment relay error:', err);
    return false;
  }
}
