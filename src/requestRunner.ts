import * as vscode from 'vscode';
import { scanText, RouteInfo } from './scan';
import { HttpClientPanel } from './httpClientPanel';

function baseUrl(): string {
  const configured = vscode.workspace.getConfiguration('sillo').get<string>('baseUrl', 'http://127.0.0.1:8000');
  return configured.replace(/\/$/, '');
}

/** `{id:int}` reads fine as a type hint in source, but as a URL it's just noise. */
function stripParamTypes(path: string): string {
  return path.replace(/\{(\w+)(?::\w+)?\}/g, '{$1}');
}

export function makeRunRouteCommand(context: vscode.ExtensionContext) {
  return (route: Pick<RouteInfo, 'method' | 'fullPath'>) => {
    // Plain concatenation, not the URL constructor: {id} still has to read as
    // an editable placeholder in the webview's URL field, and URL would
    // percent-encode the braces into %7Bid%7D on the way in.
    const url = baseUrl() + stripParamTypes(route.fullPath);
    HttpClientPanel.showRoute(context, route.method, url);
  };
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
          title: `▶ Try ${route.method} ${route.fullPath}`,
          command: 'sillo.runRoute',
          arguments: [route],
        });
      });
  }
}
