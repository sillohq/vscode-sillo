import * as vscode from 'vscode';
import * as path from 'node:path';

/**
 * Which Sillo project the editor is currently looking at, and how it's
 * configured — read from the project's own files rather than inferred by
 * scanning every Python file in the workspace.
 *
 * This matters because a workspace here (and in general) can hold more than
 * one Sillo project side by side (starter, star-ehr, a fresh test app, ...).
 * "The workspace root" is not "the project" — the project is whichever
 * directory holds the `pyproject.toml` nearest the file you're actually
 * looking at, exactly how `sillo`'s own CLI finds it (see
 * `sillo/__main__.py`, `_configured_app()` — this module's `findAppEntry`
 * mirrors that function's own text scan of `pyproject.toml`, not a generic
 * TOML parse, so the two can't disagree on what a project configured).
 */

export interface ProjectRoot {
  dir: string;
  uri: vscode.Uri;
}

export async function readFileSafe(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return undefined;
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Walks up from `start` to `stop` (inclusive), nearest directory first. */
export function ancestorsBetween(start: string, stop: string): string[] {
  const dirs: string[] = [];
  let dir = start;
  while (true) {
    dirs.push(dir);
    if (dir === stop || dir === path.dirname(dir)) break;
    dir = path.dirname(dir);
  }
  return dirs;
}

let cached: { root: ProjectRoot; forPath: string | undefined } | undefined;

/** The nearest `pyproject.toml` to the active editor, else the workspace root. */
export async function findProjectRoot(): Promise<ProjectRoot> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;

  if (cached && cached.forPath === activePath) return cached.root;

  const fallback: ProjectRoot = folder
    ? { dir: folder.uri.fsPath, uri: folder.uri }
    : { dir: process.cwd(), uri: vscode.Uri.file(process.cwd()) };

  let root = fallback;

  if (activePath && folder && activePath.startsWith(folder.uri.fsPath)) {
    for (const dir of ancestorsBetween(path.dirname(activePath), folder.uri.fsPath)) {
      if (await fileExists(vscode.Uri.file(path.join(dir, 'pyproject.toml')))) {
        root = { dir, uri: vscode.Uri.file(dir) };
        break;
      }
    }
  } else if (folder) {
    const found = await vscode.workspace.findFiles(
      '**/pyproject.toml',
      '**/{node_modules,.venv,venv,.git,__pycache__,dist,build}/**',
      1
    );
    if (found.length > 0) {
      root = { dir: path.dirname(found[0].fsPath), uri: vscode.Uri.file(path.dirname(found[0].fsPath)) };
    }
  }

  cached = { root, forPath: activePath };
  return root;
}

const DEFAULT_APPS = ['app.main:app', 'main:app', 'app:app'];

/** `module.path:attr` -> the .py file that module resolves to. */
function importStringToUri(root: ProjectRoot, importString: string): vscode.Uri | undefined {
  const modulePath = importString.split(':')[0];
  if (!modulePath) return undefined;
  return vscode.Uri.file(path.join(root.dir, ...modulePath.split('.')) + '.py');
}

/** Mirrors `sillo/__main__.py`'s own `_configured_app()` — a plain text scan
 * of `[tool.sillo] app = "..."`, not a general TOML parse. */
function parseToolSilloApp(text: string): string | undefined {
  let inSillo = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[') && line.endsWith(']')) {
      inSillo = line === '[tool.sillo]';
      continue;
    }
    if (inSillo && line.startsWith('app = ')) {
      const value = line.slice('app = '.length).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
      }
    }
  }
  return undefined;
}

export interface AppEntry {
  importString: string;
  entryUri?: vscode.Uri;
}

export async function findAppEntry(root: ProjectRoot): Promise<AppEntry | undefined> {
  const pyproject = await readFileSafe(vscode.Uri.file(path.join(root.dir, 'pyproject.toml')));
  if (pyproject) {
    const configured = parseToolSilloApp(pyproject);
    if (configured) return { importString: configured, entryUri: importStringToUri(root, configured) };
  }

  for (const candidate of DEFAULT_APPS) {
    const uri = importStringToUri(root, candidate);
    if (uri && (await fileExists(uri))) return { importString: candidate, entryUri: uri };
  }
  return undefined;
}

async function findEnvValue(root: ProjectRoot, key: string): Promise<string | undefined> {
  for (const name of ['.env', '.env.local', '.env.example']) {
    const text = await readFileSafe(vscode.Uri.file(path.join(root.dir, name)));
    if (!text) continue;
    const match = new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm').exec(text);
    if (match) return match[1].trim();
  }
  return undefined;
}

export interface ServerAddress {
  host: string;
  port: number;
}

/** HOST/PORT the project's own `.env` or `app/config.py` configure it for. */
export async function findServerAddress(root: ProjectRoot): Promise<ServerAddress | undefined> {
  const host = await findEnvValue(root, 'HOST');
  const port = await findEnvValue(root, 'PORT');
  if (host || port) return { host: host ?? '127.0.0.1', port: port ? Number(port) : 8000 };

  const configPy = await readFileSafe(vscode.Uri.file(path.join(root.dir, 'app', 'config.py')));
  if (configPy) {
    const hostMatch = /\bhost\s*:\s*str\s*=\s*"([^"]+)"/.exec(configPy);
    const portMatch = /\bport\s*:\s*int\s*=\s*(\d+)/.exec(configPy);
    if (hostMatch || portMatch) {
      return { host: hostMatch?.[1] ?? '127.0.0.1', port: portMatch ? Number(portMatch[1]) : 8000 };
    }
  }
  return undefined;
}
