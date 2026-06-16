import { config } from 'dotenv';

config();

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

/** Creates a subfolder inside the configured transcripts folder. */
export async function createTicketFolder(title: string): Promise<DocSpaceFolder | null> {
  if (!isDocSpaceConfigured()) return null;
  try {
    const res = await withTimeout(signal =>
      fetch(`${BASE}/api/2.0/files/folder/${FOLDER_ID}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
        signal,
      })
    );
    if (!res.ok) { console.error(`[docspace] folder create failed: HTTP ${res.status}`); return null; }
    const data = (await res.json()) as { response?: { id?: number; webUrl?: string } };
    const r = data.response;
    if (!r?.id) return null;
    return { folderId: r.id, webUrl: r.webUrl ?? `${BASE}/rooms/shared/${r.id}/filter?folder=${r.id}` };
  } catch (err) {
    console.error('[docspace] folder create error:', err);
    return null;
  }
}

/** Uploads an in-memory buffer as a file into a specific folder. */
export async function uploadBufferToFolder(
  folderId: number,
  filename: string,
  buffer: Buffer | Uint8Array,
  mime: string
): Promise<DocSpaceUpload | null> {
  if (!isDocSpaceConfigured()) return null;
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
export async function uploadUrlToFolder(
  folderId: number,
  url: string,
  filename: string,
  maxBytes = 25 * 1024 * 1024
): Promise<boolean> {
  if (!isDocSpaceConfigured()) return false;
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
