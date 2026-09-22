import * as vscode from 'vscode';
import { scanWorkspace, scanMigrations, RouteInfo, RouterInfo, ModelInfo, MiddlewareInfo, MigrationInfo } from './scan';

type Node =
  | { kind: 'group'; label: string; children: Node[] }
  | { kind: 'router'; info: RouterInfo }
  | { kind: 'route'; info: RouteInfo }
  | { kind: 'model'; info: ModelInfo }
  | { kind: 'middleware'; info: MiddlewareInfo }
  | { kind: 'migration'; info: MigrationInfo }
  | { kind: 'empty'; label: string };

export class SilloStructureProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private roots: Node[] = [];

  constructor() {
    this.refresh();
  }

  refresh(): void {
    Promise.all([scanWorkspace(), scanMigrations()]).then(([scan, migrations]) => {
      const routeChild = (route: RouteInfo): Node => ({ kind: 'route', info: route });

      this.roots = [
        {
          kind: 'group',
          label: 'Routers',
          children:
            scan.routers.length || scan.standaloneRoutes.length
              ? [
                  ...scan.routers.map(
                    (router): Node => ({ kind: 'router', info: router })
                  ),
                  ...scan.standaloneRoutes.map(routeChild),
                ]
              : [{ kind: 'empty', label: 'No routers found' }],
        },
        {
          kind: 'group',
          label: 'Models',
          children: scan.models.length
            ? scan.models.map((model): Node => ({ kind: 'model', info: model }))
            : [{ kind: 'empty', label: 'No models found' }],
        },
        {
          kind: 'group',
          label: 'Middleware',
          children: scan.middleware.length
            ? scan.middleware.map((mw): Node => ({ kind: 'middleware', info: mw }))
            : [{ kind: 'empty', label: 'No middleware found' }],
        },
        {
          kind: 'group',
          label: 'Migrations',
          children: migrations.length
            ? migrations.map((m): Node => ({ kind: 'migration', info: m }))
            : [{ kind: 'empty', label: 'No migrations found' }],
        },
      ];
      this._onDidChangeTreeData.fire();
    });
  }

  getTreeItem(element: Node): vscode.TreeItem {
    switch (element.kind) {
      case 'group': {
        const item = new vscode.TreeItem(
          `${element.label} (${element.children.length})`,
          vscode.TreeItemCollapsibleState.Expanded
        );
        item.contextValue = 'sillo.group';
        return item;
      }
      case 'router': {
        const { info } = element;
        const label = info.prefix ? `${info.varName}  ${info.prefix}` : info.varName;
        const item = new vscode.TreeItem(
          label,
          info.routes.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = new vscode.ThemeIcon('symbol-namespace');
        item.description = `${info.routes.length} route${info.routes.length === 1 ? '' : 's'}`;
        item.command = openAt(info.uri, info.line);
        return item;
      }
      case 'route': {
        const { info } = element;
        const item = new vscode.TreeItem(`${info.method}  ${info.fullPath}`);
        item.iconPath = new vscode.ThemeIcon('arrow-right');
        item.description = info.handlerName;
        item.command = openAt(info.uri, info.line);
        item.contextValue = 'sillo.route';
        return item;
      }
      case 'model': {
        const { info } = element;
        const item = new vscode.TreeItem(info.name);
        item.iconPath = new vscode.ThemeIcon('database');
        item.description = info.base;
        item.command = openAt(info.uri, info.line);
        return item;
      }
      case 'middleware': {
        const { info } = element;
        const item = new vscode.TreeItem(info.name);
        item.iconPath = new vscode.ThemeIcon('filter');
        item.command = openAt(info.uri, info.line);
        return item;
      }
      case 'migration': {
        const { info } = element;
        const item = new vscode.TreeItem(info.name);
        item.iconPath = new vscode.ThemeIcon('history');
        item.command = { command: 'vscode.open', title: 'Open', arguments: [info.uri] };
        return item;
      }
      case 'empty':
        return new vscode.TreeItem(element.label);
    }
  }

  getChildren(element?: Node): Node[] {
    if (!element) return this.roots;
    if ('children' in element) return element.children;
    if (element.kind === 'router') return element.info.routes.map((r) => ({ kind: 'route', info: r }));
    return [];
  }
}

function openAt(uri: vscode.Uri, line: number): vscode.Command {
  return {
    command: 'vscode.open',
    title: 'Open',
    arguments: [uri, { selection: new vscode.Range(line, 0, line, 0) }],
  };
}
