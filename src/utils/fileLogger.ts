// Persistent file logging. Import this FIRST in index.ts so it patches console
// before any other module logs. Everything printed to the console is also
// appended to logs/bot-YYYY-MM-DD.log, and crashes are captured too.
import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
// Restrict the log directory — logs may contain operational/PII data.
try { fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }

const MAX_LOG_BYTES = 10 * 1024 * 1024; // rotate the day's file once it passes 10 MB

function logFilePath(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `bot-${day}.log`);
}

// Strip anything that looks like a secret before it ever hits disk.
function redact(s: string): string {
  return s
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/[^:@/]+:)[^@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(sk-[A-Za-z0-9._-]{6,})\b/g, '[REDACTED]');
}

function fmtArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function write(level: string, args: unknown[]): void {
  const line = redact(`[${new Date().toISOString()}] [${level}] ${args.map(fmtArg).join(' ')}\n`);
  try {
    const file = logFilePath();
    // Size-cap: roll the current file aside if it grows too large.
    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) {
        fs.renameSync(file, `${file}.${Date.now()}.old`);
      }
    } catch { /* file may not exist yet */ }
    fs.appendFileSync(file, line);
  } catch { /* never let logging crash the bot */ }
}

const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

console.log = (...a: unknown[]) => { original.log(...a); write('INFO', a); };
console.info = (...a: unknown[]) => { original.info(...a); write('INFO', a); };
console.warn = (...a: unknown[]) => { original.warn(...a); write('WARN', a); };
console.error = (...a: unknown[]) => { original.error(...a); write('ERROR', a); };

// Capture crashes so they always land in the log file
process.on('unhandledRejection', (reason) => {
  write('UNHANDLED_REJECTION', [reason]);
  original.error('[fileLogger] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  write('UNCAUGHT_EXCEPTION', [err]);
  original.error('[fileLogger] uncaughtException — exiting for a clean restart:', err);
  // The process state is now undefined; exit so Docker (restart: unless-stopped)
  // brings up a fresh, healthy process. The synchronous write above already flushed.
  process.exit(1);
});

console.log(`[fileLogger] Logging to ${logFilePath()}`);

export {};
