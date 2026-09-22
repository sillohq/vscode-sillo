import * as vscode from 'vscode';
import * as http from 'node:http';
import * as https from 'node:https';
import { scanText, RouteInfo } from './scan';

const PARAM = /\{(\w+)(?::\w+)?\}/g;

let output: vscode.OutputChannel | undefined;
function channel(): vscode.OutputChannel {
  return (output ??= vscode.window.createOutputChannel('Sillo'));
}

function baseUrl(): string {
  const configured = vscode.workspace.getConfiguration('sillo').get<string>('baseUrl', 'http://127.0.0.1:8000');
  return configured.replace(/\/$/, '');
}

/** Prompts for a value for each `{name}` / `{name:type}` placeholder in the path. */
async function fillPathParams(path: string): Promise<string | undefined> {
  const names = [...path.matchAll(PARAM)].map((m) => m[1]);
  let filled = path;
  for (const name of names) {
    const value = await vscode.window.showInputBox({ prompt: `Value for path parameter "${name}"` });
    if (value === undefined) return undefined; // cancelled
    filled = filled.replace(new RegExp(`\\{${name}(?::\\w+)?\\}`), encodeURIComponent(value));
  }
  return filled;
}

async function fillBody(method: string): Promise<string | undefined> {
  if (method === 'GET' || method === 'DELETE') return undefined;
  const body = await vscode.window.showInputBox({
    prompt: `JSON body for ${method} (optional)`,
    placeHolder: '{"key": "value"}',
  });
  return body || undefined;
}

function send(url: URL, method: string, body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const transport = url.protocol === 'https:' ? https : http;
  const headers: http.OutgoingHttpHeaders = {};
  if (body) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('Request timed out after 10s')));
    if (body) req.write(body);
    req.end();
  });
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export async function runRoute(route: Pick<RouteInfo, 'method' | 'fullPath'>): Promise<void> {
  const path = await fillPathParams(route.fullPath);
  if (path === undefined) return;

  const body = await fillBody(route.method);

  let url: URL;
  try {
    url = new URL(path, baseUrl());
  } catch (err) {
    vscode.window.showErrorMessage(`Sillo: invalid URL — ${(err as Error).message}`);
    return;
  }

  const out = channel();
  out.show(true);
  out.appendLine(`\n→ ${route.method} ${url.toString()}`);
  if (body) out.appendLine(`  body: ${body}`);

  try {
    const response = await send(url, route.method, body);
    out.appendLine(`← ${response.status}`);
    for (const [key, value] of Object.entries(response.headers)) {
      out.appendLine(`  ${key}: ${value}`);
    }
    if (response.body) {
      out.appendLine('');
      out.appendLine(formatBody(response.body));
    }
  } catch (err) {
    out.appendLine(`✗ ${(err as Error).message}`);
    vscode.window.showErrorMessage(
      `Sillo: request failed — ${(err as Error).message}. Is the app running? (Sillo: Preview Application)`
    );
  }
}

export class RouteCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== 'python') return [];

    // Scanned from the live buffer (document.getText()), not disk — a
    // workspace-wide, disk-based scan here would point a second route's
    // CodeLens at stale line numbers for as long as the file has unsaved
    // edits. Prefix resolution is therefore local to this file; a router
    // declared in another module and mounted here won't get its prefix
    // picked up, which only matters for the CodeLens's displayed/requested
    // path, not for the tree view (which does scan the whole workspace).
    const scan = scanText(document.uri, document.getText());
    const routes = [...scan.routers.flatMap((r) => r.routes), ...scan.standaloneRoutes];

    return routes
      .filter((r) => r.method !== 'WEBSOCKET')
      .map((route) => {
        const range = document.lineAt(route.line).range;
        return new vscode.CodeLens(range, {
          title: `▶ Run ${route.method} ${route.fullPath}`,
          command: 'sillo.runRoute',
          arguments: [route],
        });
      });
  }
}
