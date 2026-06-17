import { spawn } from 'child_process';
import { isDocSpaceConfigured, ensureSubfolder, ensureRootFolder, uploadBufferToFolder } from './docspace';

const BACKUPS_FOLDER_NAME = 'Database Backups';

// Runs pg_dump and returns the SQL dump as a buffer (or null on failure).
// The command is fixed (no shell, no user input) — DB credentials come from
// DATABASE_URL / PG* env vars that pg_dump reads itself.
function pgDump(): Promise<Buffer | null> {
  return new Promise(resolve => {
    const url = process.env.DATABASE_URL;
    const args = ['--no-owner', '--no-privileges'];
    if (url) args.unshift(url);

    const child = spawn('pg_dump', args, { env: process.env });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);

    child.stdout.on('data', d => out.push(d as Buffer));
    child.stderr.on('data', d => err.push(d as Buffer));
    child.on('error', e => { clearTimeout(timer); console.error('[backup] pg_dump failed to start:', e); resolve(null); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error(`[backup] pg_dump exited ${code}: ${Buffer.concat(err).toString().slice(0, 500)}`);
        resolve(null);
        return;
      }
      resolve(Buffer.concat(out));
    });
  });
}

// Dumps the database and uploads it to DocSpace:
//   <room>/Database Backups/<YYYY-MM-DD>/db-backup-<timestamp>.sql
export async function runDatabaseBackup(): Promise<void> {
  if (!isDocSpaceConfigured()) {
    console.warn('[backup] DocSpace not configured — skipping database backup');
    return;
  }

  const dump = await pgDump();
  if (!dump || dump.length === 0) {
    console.error('[backup] empty dump — aborting upload');
    return;
  }

  const stamp = new Date().toISOString();
  const day = stamp.slice(0, 10);

  const backups = await ensureRootFolder(BACKUPS_FOLDER_NAME);
  if (!backups) { console.error('[backup] could not create the Database Backups folder'); return; }

  const dayFolder = await ensureSubfolder(backups.folderId, day);
  if (!dayFolder) { console.error('[backup] could not create the dated folder'); return; }

  const filename = `db-backup-${stamp.replace(/[:.]/g, '-')}.sql`;
  const uploaded = await uploadBufferToFolder(dayFolder.folderId, filename, dump, 'application/sql');
  console.log(uploaded
    ? `[backup] uploaded ${filename} (${dump.length} bytes) to DocSpace`
    : '[backup] upload to DocSpace failed');
}
