// Persistent file logging. Import this FIRST in index.ts so it patches console
// before any other module logs. Everything printed to the console is also
// appended to logs/bot-YYYY-MM-DD.log, and crashes are captured too.
import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

function logFilePath(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `bot-${day}.log`);
}

function fmtArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function write(level: string, args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(fmtArg).join(' ')}\n`;
  try { fs.appendFileSync(logFilePath(), line); } catch { /* never let logging crash the bot */ }
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
  original.error('[fileLogger] uncaughtException:', err);
});

console.log(`[fileLogger] Logging to ${logFilePath()}`);

export {};
