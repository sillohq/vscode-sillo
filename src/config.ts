import * as vscode from 'vscode';
import { findProjectRoot, findServerAddress, ProjectRoot } from './project';

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
 * An explicit workspace setting wins. Otherwise use Sillo's own development
 * command, which reads `[tool.sillo] app` and owns the reload/logging
 * experience instead of the extension reconstructing a uvicorn invocation.
 */
export async function resolveDevCommand(): Promise<{ command: string; root: ProjectRoot }> {
  const root = await findProjectRoot();
  const inspected = vscode.workspace.getConfiguration('sillo').inspect<string>('devServerCommand');
  const explicit = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
  if (explicit) return { command: explicit, root };

  return { command: inspected?.defaultValue ?? 'uv run sillo dev', root };
}
