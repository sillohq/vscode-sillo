import * as vscode from 'vscode';
import { findProjectRoot, findServerAddress, findAppEntry, ProjectRoot } from './project';

/**
 * The base URL to test routes against.
 *
 * `sillo.baseUrl` defaults to `http://127.0.0.1:8000` in package.json, which
 * is wrong the moment a project's `.env`/`config.py` says otherwise — this
 * was the actual bug ("always tests from 8000"). So the setting's *default*
 * value is only a last resort: an explicit value the user (or workspace)
 * actually set always wins, but when nothing was explicitly set, the
 * project's own HOST/PORT is used instead of the setting's baked-in default.
 */
export async function resolveBaseUrl(): Promise<string> {
  const inspected = vscode.workspace.getConfiguration('sillo').inspect<string>('baseUrl');
  const explicit = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
  if (explicit) return explicit.replace(/\/$/, '');

  const root = await findProjectRoot();
  const address = await findServerAddress(root);
  if (address) {
    const host = address.host === '0.0.0.0' ? '127.0.0.1' : address.host;
    return `http://${host}:${address.port}`;
  }

  return (inspected?.defaultValue ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
}

/**
 * The command to run the dev server with.
 *
 * Same "explicit setting wins, otherwise read the project" shape as
 * `resolveBaseUrl`: `sillo.devServerCommand` defaults to `uvicorn
 * app.main:app --reload`, which is only right for a project that actually
 * uses that layout. `findAppEntry` reads the real one — `[tool.sillo] app`
 * in `pyproject.toml`, or the same `app.main:app` / `main:app` / `app:app`
 * guesses `sillo`'s own CLI tries, in that order.
 */
export async function resolveDevCommand(): Promise<{ command: string; root: ProjectRoot }> {
  const root = await findProjectRoot();
  const inspected = vscode.workspace.getConfiguration('sillo').inspect<string>('devServerCommand');
  const explicit = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
  if (explicit) return { command: explicit, root };

  const entry = await findAppEntry(root);
  const address = await findServerAddress(root);
  if (entry) {
    const host = address?.host ?? '127.0.0.1';
    const port = address?.port ?? 8000;
    return { command: `uvicorn ${entry.importString} --reload --host ${host} --port ${port}`, root };
  }

  return { command: inspected?.defaultValue ?? 'uvicorn app.main:app --reload', root };
}
