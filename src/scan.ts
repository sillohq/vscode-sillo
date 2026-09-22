import * as vscode from 'vscode';

/**
 * Lightweight, regex-based scanning of the workspace's Python files for
 * Sillo constructs — routers, routes, models and middleware.
 *
 * This is intentionally not a real Python parser: it is good enough to
 * populate a tree view and CodeLenses without depending on a Python
 * language server being installed or configured. Anything written across
 * unusual line breaks (a multi-line decorator, a class body opened on its
 * own line) will simply be missed rather than mis-parsed.
 */

export interface RouteInfo {
  method: string;
  path: string;
  fullPath: string;
  handlerName: string;
  uri: vscode.Uri;
  line: number;
}

export interface RouterInfo {
  varName: string;
  prefix: string;
  uri: vscode.Uri;
  line: number;
  routes: RouteInfo[];
}

export interface ModelInfo {
  name: string;
  base: string;
  uri: vscode.Uri;
  line: number;
}

export interface MiddlewareInfo {
  name: string;
  uri: vscode.Uri;
  line: number;
}

export interface WorkspaceScan {
  routers: RouterInfo[];
  standaloneRoutes: RouteInfo[];
  models: ModelInfo[];
  middleware: MiddlewareInfo[];
}

const ROUTE_DECORATOR = /^\s*@(\w+)\.(get|post|put|patch|delete|websocket)\(\s*["']([^"']+)["']/;
const HANDLER_DEF = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/;
const ROUTER_DECL = /(\w+)\s*=\s*Router\(([^)]*)\)/;
const ROUTER_PREFIX = /prefix\s*=\s*["']([^"']*)["']/;
const CLASS_DECL = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/;

async function findPythonFiles(): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles(
    '**/*.py',
    '**/{node_modules,.venv,venv,.git,__pycache__,dist,build}/**',
    2000
  );
}

function joinPath(prefix: string, path: string): string {
  const left = prefix.replace(/\/$/, '');
  const right = path.startsWith('/') ? path : `/${path}`;
  return `${left}${right}` || '/';
}

export async function scanWorkspace(): Promise<WorkspaceScan> {
  const routers: RouterInfo[] = [];
  const standaloneRoutes: RouteInfo[] = [];
  const models: ModelInfo[] = [];
  const middleware: MiddlewareInfo[] = [];

  const files = await findPythonFiles();

  for (const uri of files) {
    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const routerByVar = new Map<string, RouterInfo>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const routerMatch = ROUTER_DECL.exec(line);
      if (routerMatch) {
        const [, varName, args] = routerMatch;
        const prefixMatch = ROUTER_PREFIX.exec(args);
        const info: RouterInfo = {
          varName,
          prefix: prefixMatch ? prefixMatch[1] : '',
          uri,
          line: i,
          routes: [],
        };
        routerByVar.set(varName, info);
        routers.push(info);
        continue;
      }

      const classMatch = CLASS_DECL.exec(line);
      if (classMatch) {
        const [, name, bases] = classMatch;
        if (/\bMiddleware\b/.test(bases)) {
          middleware.push({ name, uri, line: i });
        } else if (/\bModel\b/.test(bases)) {
          models.push({ name, base: bases.trim(), uri, line: i });
        }
        continue;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const routeMatch = ROUTE_DECORATOR.exec(lines[i]);
      if (!routeMatch) continue;
      const [, receiver, method, path] = routeMatch;

      let handlerName = '';
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const handlerMatch = HANDLER_DEF.exec(lines[j]);
        if (handlerMatch) {
          handlerName = handlerMatch[1];
          break;
        }
        if (!lines[j].trim().startsWith('@') && lines[j].trim() !== '') break;
      }

      const router = routerByVar.get(receiver);
      const route: RouteInfo = {
        method: method.toUpperCase(),
        path,
        fullPath: joinPath(router?.prefix ?? '', path),
        handlerName,
        uri,
        line: i,
      };

      if (router) router.routes.push(route);
      else standaloneRoutes.push(route);
    }
  }

  return { routers, standaloneRoutes, models, middleware };
}
