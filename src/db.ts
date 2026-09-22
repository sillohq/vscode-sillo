import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import * as path from 'node:path';

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
  | { kind: 'not-found' };

async function readFileSafe(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return undefined;
  }
}

export async function findDatabase(): Promise<DbLocation> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return { kind: 'not-found' };

  const candidates = await vscode.workspace.findFiles(
    '{.env,.env.local,.env.example,**/config.py}',
    '**/{node_modules,.venv,venv,.git,__pycache__,dist,build}/**',
    100
  );

  for (const uri of candidates) {
    const text = await readFileSafe(uri);
    if (!text) continue;

    const sqliteMatch = SQLITE_URL.exec(text);
    if (sqliteMatch) {
      return { kind: 'sqlite', path: path.resolve(folder.uri.fsPath, sqliteMatch[1]) };
    }

    const otherMatch = ANY_DB_URL.exec(text);
    if (otherMatch && otherMatch[1] !== 'sqlite') {
      return { kind: 'unsupported', scheme: otherMatch[1] };
    }
  }

  return { kind: 'not-found' };
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
