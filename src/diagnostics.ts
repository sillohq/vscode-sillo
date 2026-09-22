import * as vscode from 'vscode';

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

  const update = (document: vscode.TextDocument) => {
    if (document.languageId !== 'python') return;
    collection.set(document.uri, lint(document));
  };

  vscode.workspace.textDocuments.forEach(update);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidChangeTextDocument((e) => update(e.document)),
    vscode.workspace.onDidSaveTextDocument(update),
    vscode.workspace.onDidCloseTextDocument((document) => collection.delete(document.uri))
  );
}
