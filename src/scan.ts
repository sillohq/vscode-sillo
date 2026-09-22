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

export interface JobInfo {
  name: string;
  uri: vscode.Uri;
  line: number;
}

export interface WorkspaceScan {
  routers: RouterInfo[];
  standaloneRoutes: RouteInfo[];
  models: ModelInfo[];
  middleware: MiddlewareInfo[];
  jobs: JobInfo[];
}

const ROUTE_DECORATOR = /^\s*@(\w+)\.(get|post|put|patch|delete|websocket)\(\s*["']([^"']+)["']/;
const HANDLER_DEF = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/;
const ROUTER_DECL = /(\w+)\s*=\s*Router\(([^)]*)\)/;
const ROUTER_PREFIX = /prefix\s*=\s*["']([^"']*)["']/;
const CLASS_DECL = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/;
const EXCLUDE_GLOB = '**/{node_modules,.venv,venv,.git,__pycache__,dist,build}/**';

/**
 * Scoped to one project's directory (see project.ts) rather than the whole
 * VS Code workspace — this repo alone opens several Sillo projects side by
 * side, and a workspace-wide scan mixes their routes, models and jobs
 * together in the tree view with no indication any of it came from a
 * different app.
 */
async function findPythonFiles(root?: vscode.Uri): Promise<vscode.Uri[]> {
  const pattern = root ? new vscode.RelativePattern(root, '**/*.py') : '**/*.py';
  return vscode.workspace.findFiles(pattern, EXCLUDE_GLOB, 2000);
}

export interface MigrationInfo {
  name: string;
  uri: vscode.Uri;
}

/**
 * Migration files on disk, sorted by filename (Sillo names them
 * `NNNN_description.py`, so filename order is application order).
 *
 * This lists what exists, not what's applied — telling those apart needs a
 * database connection, which is exactly what `sillo db:status` is for (see
 * the "Sillo: Migration Status" command). Parsing that command's coloured,
 * human-oriented terminal output well enough to show "applied" state here
 * reliably was judged not worth the fragility.
 */
export async function scanMigrations(root?: vscode.Uri): Promise<MigrationInfo[]> {
  const pattern = root ? new vscode.RelativePattern(root, '**/migrations/*.py') : '**/migrations/*.py';
  const files = await vscode.workspace.findFiles(pattern, EXCLUDE_GLOB, 500);
  return files
    .filter((uri) => !uri.path.endsWith('__init__.py'))
    .map((uri) => ({ name: uri.path.split('/').pop() ?? uri.path, uri }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function joinPath(prefix: string, path: string): string {
  const left = prefix.replace(/\/$/, '');
  const right = path.startsWith('/') ? path : `/${path}`;
  return `${left}${right}` || '/';
}

/**
 * Scans one file's text. Split out of `scanWorkspace` so a document already
 * open in the editor can be scanned from its live buffer — the tree view and
 * diagnostics only need the on-disk version, but a CodeLens computed against
 * disk content for a document with unsaved edits points at stale lines the
 * moment there's more than one route in the file.
 */
export function scanText(uri: vscode.Uri, text: string): WorkspaceScan {
  const routers: RouterInfo[] = [];
  const standaloneRoutes: RouteInfo[] = [];
  const models: ModelInfo[] = [];
  const middleware: MiddlewareInfo[] = [];
  const jobs: JobInfo[] = [];

  const lines = text.split(/\r?\n/);
  const routerByVar = new Map<string, RouterInfo>();

  // Pass 1: router declarations and class definitions can appear anywhere.
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
      } else if (/\bJob\b/.test(bases)) {
        // sillo.work.queue.job.Job — subclass and implement handle(), per
        // its own docstring example (class SendWelcomeEmail(Job): ...).
        jobs.push({ name, uri, line: i });
      } else if (/\bModel\b/.test(bases)) {
        models.push({ name, base: bases.trim(), uri, line: i });
      }
      continue;
    }
  }

  // Pass 2: route decorators, resolved against routers found in this file.
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

  return { routers, standaloneRoutes, models, middleware, jobs };
}

export async function scanWorkspace(root?: vscode.Uri): Promise<WorkspaceScan> {
  const routers: RouterInfo[] = [];
  const standaloneRoutes: RouteInfo[] = [];
  const models: ModelInfo[] = [];
  const middleware: MiddlewareInfo[] = [];
  const jobs: JobInfo[] = [];

  const files = await findPythonFiles(root);

  for (const uri of files) {
    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      continue;
    }
    const scanned = scanText(uri, text);
    routers.push(...scanned.routers);
    standaloneRoutes.push(...scanned.standaloneRoutes);
    models.push(...scanned.models);
    middleware.push(...scanned.middleware);
    jobs.push(...scanned.jobs);
  }

  return { routers, standaloneRoutes, models, middleware, jobs };
}
