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
  /** The table this model reads/writes — `Meta.table` if set, else Tortoise's
   * own default (the lowercased class name), for the DB viewer's "view data"
   * button to jump straight to. */
  table: string;
  uri: vscode.Uri;
  line: number;
}

export interface MiddlewareInfo {
  name: string;
  uri: vscode.Uri;
  line: number;
  /** 'defined': a `class X(...Middleware):` in this project. 'applied':
   * only ever seen passed to `.use(X(...))` — most often a framework
   * built-in (CORSMiddleware, SessionMiddleware, ...) rather than anything
   * this project defines itself. */
  kind: 'defined' | 'applied';
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
const CLASS_META = /^\s*class\s+Meta\s*:/;
const META_TABLE = /^\s*table\s*=\s*["']([^"']+)["']/;
const APPLIED_MIDDLEWARE = /\.use\(\s*(\w+)\(/;
const USE_CALL_OPEN = /\.use\(\s*$/;
const BARE_CLASS_CALL = /^\s*(\w+)\(/;
const EXCLUDE_GLOB = '**/{node_modules,.venv,venv,.git,__pycache__,dist,build}/**';

/**
 * Real base-class names are always suffixed, never standalone words —
 * `BaseMiddleware`, `UserBaseModel`, `SendWelcomeEmail`'s `Job` — so a
 * `\bMiddleware\b`-style regex never fires: `\b` only matches between a word
 * character and a non-word one, and "eMiddleware" has no such boundary.
 * `BaseModel` (bare, no prefix) is excluded because that's Pydantic's own
 * base for request/response schemas (see models.ts), not an ORM table.
 */
function baseTokens(bases: string): string[] {
  return bases
    .split(',')
    .map((token) => token.trim().split('[')[0].trim())
    .filter(Boolean);
}

function classifyBases(bases: string): 'middleware' | 'job' | 'model' | undefined {
  const tokens = baseTokens(bases);
  if (tokens.some((t) => t.endsWith('Middleware'))) return 'middleware';
  if (tokens.some((t) => t.endsWith('Job'))) return 'job';
  if (tokens.some((t) => t.endsWith('Model') && t !== 'BaseModel')) return 'model';
  return undefined;
}

/** `Meta.table` if the class body sets one within a reasonable lookahead,
 * else Tortoise's own default: the model class name, lowercased. */
function findTableName(lines: string[], classLine: number, className: string): string {
  for (let i = classLine + 1; i < Math.min(classLine + 30, lines.length); i++) {
    if (/^class\s+\w+/.test(lines[i]) && !CLASS_META.test(lines[i])) break;
    if (CLASS_META.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
        if (/^\s*class\s+\w+/.test(lines[j])) break;
        const match = META_TABLE.exec(lines[j]);
        if (match) return match[1];
      }
      break;
    }
  }
  return className.toLowerCase();
}

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
      switch (classifyBases(bases)) {
        case 'middleware':
          middleware.push({ name, uri, line: i, kind: 'defined' });
          break;
        case 'job':
          // sillo.work.queue.job.Job — subclass and implement handle(), per
          // its own docstring example (class SendWelcomeEmail(Job): ...).
          jobs.push({ name, uri, line: i });
          break;
        case 'model':
          models.push({ name, base: bases.trim(), table: findTableName(lines, i, name), uri, line: i });
          break;
      }
      continue;
    }

    // Middleware actually wired into the app, whether or not it's a class
    // this project defines — most `.use(...)` calls pass a framework
    // built-in (CORSMiddleware, SessionMiddleware, AuthenticationMiddleware)
    // that has no local class declaration for the check above to find.
    // The two most-formatted-by-black shapes: `.use(XMiddleware(` on one
    // line, or `.use(` alone with `XMiddleware(` starting the next.
    const appliedMatch = APPLIED_MIDDLEWARE.exec(line);
    if (appliedMatch) {
      middleware.push({ name: appliedMatch[1], uri, line: i, kind: 'applied' });
    } else if (USE_CALL_OPEN.test(line)) {
      const nextMatch = BARE_CLASS_CALL.exec(lines[i + 1] ?? '');
      if (nextMatch) middleware.push({ name: nextMatch[1], uri, line: i + 1, kind: 'applied' });
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
  const middlewareByName = new Map<string, MiddlewareInfo>();
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
    jobs.push(...scanned.jobs);

    for (const mw of scanned.middleware) {
      // A name seen as 'applied' anywhere and 'defined' anywhere else is one
      // middleware, and the definition is the more useful place to land —
      // an import string alone is imported randomly.
      const existing = middlewareByName.get(mw.name);
      if (!existing || (existing.kind === 'applied' && mw.kind === 'defined')) {
        middlewareByName.set(mw.name, mw);
      }
    }
  }

  return { routers, standaloneRoutes, models, middleware: [...middlewareByName.values()], jobs };
}
