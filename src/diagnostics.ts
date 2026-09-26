import * as vscode from 'vscode';
import { findAppEntry, findProjectRoot } from './project';
import { scanWorkspace } from './scan';

/**
 * Best-practice / correctness checks for Sillo code, shown as red squiggles.
 *
 * Regex-based on purpose, same tradeoff as scan.ts: no Python parser, so
 * anything spread across unusual line breaks is missed rather than
 * mis-flagged. See docs/best-practices.md for what each rule means and why.
 */

const APP_DECL = /(\w+)\s*=\s*SilloApp\(/;
const RUN_CALL = /\.run\(\s*\)/;
const CTX_DB = /\bctx\.db\b/;
const CTX_RESPONSE_CALL = /\bctx\.(json|html|text|redirect|file|stream)\s*\(/;

const SOURCE = 'sillo';

function findAppVars(lines: string[]): Set<string> {
  const vars = new Set<string>();
  for (const line of lines) {
    const match = APP_DECL.exec(line);
    if (match) vars.add(match[1]);
  }
  return vars;
}

function diagnostic(range: vscode.Range, message: string, code: string): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  diag.source = SOURCE;
  diag.code = code;
  return diag;
}

function warning(line: number, message: string, code: string): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(
    new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
    message,
    vscode.DiagnosticSeverity.Warning
  );
  diag.source = SOURCE;
  diag.code = code;
  return diag;
}

export function lint(document: vscode.TextDocument): vscode.Diagnostic[] {
  if (document.languageId !== 'python') return [];

  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const appVars = findAppVars(lines);
  const diagnostics: vscode.Diagnostic[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const appVar of appVars) {
      const runMatch = new RegExp(`\\b${appVar}${RUN_CALL.source}`).exec(line);
      if (runMatch) {
        const start = line.indexOf(runMatch[0]);
        diagnostics.push(
          diagnostic(
            new vscode.Range(i, start, i, start + runMatch[0].length),
            `${appVar}.run() is for testing only — the framework warns on it. Run with "uvicorn app:app --reload" instead.`,
            'app-run'
          )
        );
      }
    }

    const dbMatch = CTX_DB.exec(line);
    if (dbMatch) {
      const start = line.indexOf(dbMatch[0]);
      diagnostics.push(
        diagnostic(
          new vscode.Range(i, start, i, start + dbMatch[0].length),
          'ctx has no "db" attribute. Query models directly (e.g. User.objects...), or use ctx.state.',
          'ctx-db'
        )
      );
    }

    let responseMatch: RegExpExecArray | null;
    const responseRegex = new RegExp(CTX_RESPONSE_CALL, 'g');
    while ((responseMatch = responseRegex.exec(line))) {
      const name = responseMatch[1];
      const start = responseMatch.index;
      diagnostics.push(
        diagnostic(
          new vscode.Range(i, start, i, start + responseMatch[0].length - 1),
          `ctx.${name}(...) isn't a response builder. Import ${name} from sillo and return ${name}(...) instead.`,
          'ctx-response-call'
        )
      );
    }
  }

  return diagnostics;
}

export function registerDiagnostics(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('sillo');
  context.subscriptions.push(collection);
  const local = new Map<string, vscode.Diagnostic[]>();
  const project = new Map<string, vscode.Diagnostic[]>();

  const publish = () => {
    collection.clear();
    const all = new Set([...local.keys(), ...project.keys()]);
    for (const key of all) {
      const uri = vscode.Uri.parse(key);
      collection.set(uri, [...(local.get(key) ?? []), ...(project.get(key) ?? [])]);
    }
  };

  const update = (document: vscode.TextDocument) => {
    if (document.languageId !== 'python') return;
    local.set(document.uri.toString(), lint(document));
    publish();
  };

  const auditProject = async () => {
    const root = await findProjectRoot();
    const [entry, scan] = await Promise.all([findAppEntry(root), scanWorkspace(root.uri)]);
    project.clear();
    // Without an identified application assembly module, a static scan cannot
    // honestly know whether a router is mounted by code outside this project.
    // Do not create noisy "not mounted" warnings; Configure Project can set
    // sillo.appEntry for projects that do not use [tool.sillo] app.
    if (!entry) {
      publish();
      return;
    }
    const add = (uri: vscode.Uri, diag: vscode.Diagnostic) => {
      const key = uri.toString();
      project.set(key, [...(project.get(key) ?? []), diag]);
    };
    for (const router of scan.routers) {
      if (!router.mounted) {
        add(router.uri, warning(router.line, `Router "${router.varName}" is not mounted. Call application.mount_router(${router.varName}).`, 'router-not-mounted'));
      }
    }
    for (const middleware of scan.middleware) {
      if (middleware.kind === 'defined' && !middleware.registered) {
        add(middleware.uri, warning(middleware.line, `Middleware "${middleware.name}" is not registered. Call application.use(${middleware.name}(...)).`, 'middleware-not-registered'));
      }
    }
    publish();
  };

  vscode.workspace.textDocuments.forEach(update);
  void auditProject();

  let auditTimer: NodeJS.Timeout | undefined;
  const scheduleAudit = () => {
    clearTimeout(auditTimer);
    auditTimer = setTimeout(() => void auditProject(), 350);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidChangeTextDocument((e) => { update(e.document); scheduleAudit(); }),
    vscode.workspace.onDidSaveTextDocument((document) => { update(document); scheduleAudit(); }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      local.delete(document.uri.toString());
      publish();
    }),
    vscode.workspace.onDidCreateFiles(scheduleAudit),
    vscode.workspace.onDidDeleteFiles(scheduleAudit),
    { dispose: () => clearTimeout(auditTimer) }
  );
}
