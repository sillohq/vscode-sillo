import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { findProjectRoot, readFileSafe } from './project';

/**
 * Finding and reading the project's SQLite database, for the DB viewer.
 *
 * Sillo's `DatabaseConfig.url` is a Tortoise-style URL — `sqlite://storage/app.db`
 * for the common local case (confirmed against the starter kit's
 * `app/config.py` and `.env.example`, both `sqlite://storage/starter.db`).
 * Finding it means grepping `.env*` and `.py` files for that URL rather than
 * running the project's own config loader, which would mean executing
 * arbitrary project code from the extension.
 */

const SQLITE_URL = /sqlite:\/\/([^\s"'\\]+)/;
const ANY_DB_URL = /(?:database_url|DATABASE_URL)\s*[:=]\s*["']?(\w+):\/\//;

export type DbLocation =
  | { kind: 'sqlite'; path: string }
  | { kind: 'unsupported'; scheme: string }
  | { kind: 'not-found'; checked: string[] };

/** A `sillo://...` URL is relative to the project it's configured for, not
 * necessarily the workspace root — a monorepo like this one opens several
 * projects (star-ehr, starter, ...) under one root, each with its own
 * `.env`/`config.py` a few directories down. Resolve against the directory
 * the match was found in. */
function resolveFrom(uri: vscode.Uri, relativePath: string): string {
  return path.resolve(path.dirname(uri.fsPath), relativePath);
}

function checkText(uri: vscode.Uri, text: string): DbLocation | undefined {
  const sqliteMatch = SQLITE_URL.exec(text);
  if (sqliteMatch) return { kind: 'sqlite', path: resolveFrom(uri, sqliteMatch[1]) };

  const otherMatch = ANY_DB_URL.exec(text);
  if (otherMatch && otherMatch[1] !== 'sqlite') return { kind: 'unsupported', scheme: otherMatch[1] };

  return undefined;
}

const DB_FILE = /\.(db|sqlite3?)$/i;

/** Exactly one database-looking file directly under `dir`, if there is one —
 * the last resort when nothing names the path in text anywhere. Several
 * matches is treated the same as none: guessing wrong is worse than saying
 * so, and `sillo.databasePath` is the way out either way. */
async function soleDbFileIn(dir: vscode.Uri): Promise<string | undefined> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return undefined;
  }
  const matches = entries.filter(([name, type]) => type === vscode.FileType.File && DB_FILE.test(name));
  return matches.length === 1 ? path.join(dir.fsPath, matches[0][0]) : undefined;
}

export async function findDatabase(): Promise<DbLocation> {
  const root = await findProjectRoot();

  const configuredPath = vscode.workspace.getConfiguration('sillo').get<string>('databasePath');
  if (configuredPath) return { kind: 'sqlite', path: path.resolve(root.dir, configuredPath) };

  // Same "nearest pyproject.toml to the active file" project as everything
  // else (see project.ts) — a `.env` found by searching the whole workspace
  // is exactly the bug this used to have: right file, wrong project, so a
  // path resolved against it points at a database that was never created.
  const checked: string[] = [];
  for (const name of ['.env', '.env.local', '.env.example', 'app/config.py']) {
    const uri = vscode.Uri.file(path.join(root.dir, name));
    checked.push(uri.fsPath);
    const text = await readFileSafe(uri);
    if (!text) continue;
    const found = checkText(uri, text);
    if (found) return found;
  }

  // Nothing named a path in text — try the obvious directories directly.
  for (const dir of ['storage', '.']) {
    const dirUri = vscode.Uri.file(path.join(root.dir, dir));
    checked.push(`${dirUri.fsPath}/*.db`);
    const sole = await soleDbFileIn(dirUri);
    if (sole) return { kind: 'sqlite', path: sole };
  }

  return { kind: 'not-found', checked };
}

function runSqlite3(dbPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('sqlite3', [dbPath, ...args], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

export async function sqlite3Available(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('sqlite3', ['--version'], (err) => resolve(!err));
  });
}

export async function listTables(dbPath: string): Promise<string[]> {
  const out = await runSqlite3(dbPath, ['.tables']);
  return out.split(/\s+/).map((t) => t.trim()).filter(Boolean);
}

export interface TableData {
  columns: string[];
  rows: string[][];
}

export async function queryTable(dbPath: string, table: string, limit = 200): Promise<TableData> {
  // `table` only ever comes from listTables()'s own output — a real
  // identifier sqlite already agreed to — so quoting it into the SQL string
  // here doesn't take arbitrary input.
  const sql = `SELECT * FROM "${table}" LIMIT ${limit};`;
  const csv = await runSqlite3(dbPath, ['-header', '-csv', sql]);
  const rows = parseCsv(csv);
  if (rows.length === 0) return { columns: [], rows: [] };
  return { columns: rows[0], rows: rows.slice(1) };
}

/** Minimal RFC 4180 CSV parser — quoted fields, "" escapes, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
