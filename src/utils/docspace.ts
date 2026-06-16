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

/**
 * Uploads an HTML transcript into the configured DocSpace folder.
 * Returns the file id + internal web URL, or null if DocSpace isn't configured
 * or the upload fails (caller should degrade gracefully).
 */
export async function uploadTranscript(
  filename: string,
  html: string
): Promise<DocSpaceUpload | null> {
  if (!isDocSpaceConfigured()) return null;

  try {
    const form = new FormData();
    form.append('title', filename);
    form.append('createNewIfExist', 'true');
    form.append('file', new Blob([html], { type: 'text/html' }), filename);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let res: Response;
    try {
      res = await fetch(`${BASE}/api/2.0/files/${FOLDER_ID}/insert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      console.error(`[docspace] upload failed: HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { response?: { id?: number; webUrl?: string } };
    const r = data.response;
    if (!r?.id) {
      console.error('[docspace] upload response missing file id');
      return null;
    }

    return {
      fileId: r.id,
      webUrl: r.webUrl ?? `${BASE}/doceditor?fileid=${r.id}&action=view`,
    };
  } catch (err) {
    console.error('[docspace] upload error:', err);
    return null;
  }
}
