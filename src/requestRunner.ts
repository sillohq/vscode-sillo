import * as vscode from 'vscode';
import { formatBody, sendRequest } from './http';
import { resolveBaseUrl } from './config';
import { RouteInfo, scanText } from './scan';

interface RequestOptions { url: string; headers: Record<string, string>; body?: string; }
const requestOptions = new Map<string, RequestOptions>();

function stripParamTypes(path: string): string { return path.replace(/\{(\w+)(?::\w+)?\}/g, '{$1}'); }
function keyFor(route: Pick<RouteInfo, 'method' | 'fullPath'>): string { return `${route.method} ${route.fullPath}`; }

async function optionsFor(route: Pick<RouteInfo, 'method' | 'fullPath'>): Promise<RequestOptions> {
  const existing = requestOptions.get(keyFor(route));
  if (existing) return existing;
  const options: RequestOptions = {
    url: (await resolveBaseUrl()) + stripParamTypes(route.fullPath),
    headers: route.method === 'GET' || route.method === 'DELETE' ? {} : { 'Content-Type': 'application/json' },
  };
  requestOptions.set(keyFor(route), options);
  return options;
}

async function send(route: Pick<RouteInfo, 'method' | 'fullPath'>, output: vscode.OutputChannel): Promise<void> {
  const options = await optionsFor(route);
  if (/\{[^}]+\}/.test(options.url)) {
    const url = await vscode.window.showInputBox({ prompt: 'Replace path parameters before sending', value: options.url });
    if (!url) return;
    options.url = url;
  }
  output.show(true);
  output.appendLine(`\n→ ${route.method} ${options.url}`);
  for (const [name, value] of Object.entries(options.headers)) output.appendLine(`${name}: ${value}`);
  if (options.body) output.appendLine(`\n${options.body}`);
  try {
    const response = await sendRequest(new URL(options.url), route.method, options.headers, options.body);
    output.appendLine(`\n← ${response.status} ${response.status < 400 ? 'OK' : 'ERROR'}`);
    for (const [name, value] of Object.entries(response.headers)) output.appendLine(`${name}: ${value}`);
    output.appendLine(`\n${formatBody(response.body, String(response.headers['content-type'] ?? ''))}`);
    vscode.window.showInformationMessage(`Sillo: ${route.method} ${route.fullPath} → ${response.status}`);
  } catch (error) {
    output.appendLine(`\nRequest failed: ${(error as Error).message}`);
    vscode.window.showErrorMessage(`Sillo request failed: ${(error as Error).message}`);
  }
}

export function makeRunRouteCommand(output: vscode.OutputChannel) {
  return async (route: Pick<RouteInfo, 'method' | 'fullPath'>) => {
    await send(route, output);
  };
}

export class RouteCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  refresh(): void { this._onDidChangeCodeLenses.fire(); }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== 'python') return [];
    const scan = scanText(document.uri, document.getText());
    const routes = [...scan.routers.flatMap((router) => router.routes), ...scan.standaloneRoutes];
    return routes.filter((route) => route.method !== 'WEBSOCKET').flatMap((route) => {
      const range = document.lineAt(route.line).range;
      return [new vscode.CodeLens(range, { title: `▶ Run ${route.method} ${route.fullPath}`, command: 'sillo.runRoute', arguments: [route] })];
    });
  }
}
