import * as vscode from 'vscode';
import { CTX_MEMBERS } from './ctxApi';
import { SilloStructureProvider } from './treeView';
import { RouteCodeLensProvider, runRoute } from './requestRunner';
import { registerDiagnostics } from './diagnostics';
import { ModelKwargCompletionProvider, ValidatedDataDefinitionProvider } from './models';

const PYTHON: vscode.DocumentSelector = { language: 'python' };

/** Matches `ctx.name` (or `<anything>ctx.name`) ending right at `position`. */
const CTX_MEMBER_ACCESS = /(?:^|[^.\w])ctx\.(\w*)$/;

function markdownFor(name: string): vscode.MarkdownString | undefined {
  const member = CTX_MEMBERS.find((m) => m.name === name);
  if (!member) return undefined;
  const md = new vscode.MarkdownString();
  md.appendCodeblock(member.signature, 'python');
  md.appendMarkdown(member.detail);
  return md;
}

class CtxHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const wordRange = document.getWordRangeAtPosition(position, /\w+/);
    if (!wordRange) return undefined;
    const word = document.getText(wordRange);

    const linePrefix = document.lineAt(position.line).text.slice(0, wordRange.start.character);
    if (!/(?:^|[^.\w])ctx\.$/.test(linePrefix)) return undefined;

    const markdown = markdownFor(word);
    if (!markdown) return undefined;
    return new vscode.Hover(markdown, wordRange);
  }
}

class CtxCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    if (!CTX_MEMBER_ACCESS.test(linePrefix)) return undefined;

    return CTX_MEMBERS.map((member) => {
      const item = new vscode.CompletionItem(
        member.name,
        member.kind === 'method' ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property
      );
      item.detail = member.signature;
      item.documentation = markdownFor(member.name);
      if (member.kind === 'method') {
        item.insertText = new vscode.SnippetString(`${member.name}($1)`);
      }
      return item;
    });
  }
}

function cliCommand(): string {
  return vscode.workspace.getConfiguration('sillo').get<string>('cliCommand', 'sillo');
}

function runInTerminal(args: string): void {
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  const terminal = vscode.window.terminals.find((t) => t.name === 'Sillo') ??
    vscode.window.createTerminal({ name: 'Sillo', cwd });
  terminal.show();
  terminal.sendText(`${cliCommand()} ${args}`.trim());
}

async function runCommandPicker(): Promise<void> {
  const args = await vscode.window.showInputBox({
    prompt: 'Sillo CLI arguments',
    placeHolder: 'e.g. db:make add_users, routes, queue:list',
  });
  if (args) runInTerminal(args);
}

function baseUrl(): string {
  return vscode.workspace.getConfiguration('sillo').get<string>('baseUrl', 'http://127.0.0.1:8000');
}

async function openInBrowser(url: string): Promise<void> {
  const opened = await vscode.commands.executeCommand('simpleBrowser.show', url).then(
    () => true,
    () => false
  );
  if (!opened) await vscode.env.openExternal(vscode.Uri.parse(url));
}

async function previewApplication(): Promise<void> {
  const devCommand = vscode.workspace.getConfiguration('sillo').get<string>(
    'devServerCommand',
    'uvicorn app.main:app --reload'
  );
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  const terminal = vscode.window.terminals.find((t) => t.name === 'Sillo Server') ??
    vscode.window.createTerminal({ name: 'Sillo Server', cwd });
  terminal.show();
  terminal.sendText(devCommand);

  await openInBrowser(baseUrl());
}

async function openApiDocs(): Promise<void> {
  const docsPath = vscode.workspace.getConfiguration('sillo').get<string>('docsPath', '/docs');
  await openInBrowser(`${baseUrl().replace(/\/$/, '')}${docsPath}`);
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

async function newMiddleware(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('Sillo: open a folder first.');
    return;
  }

  const className = await vscode.window.showInputBox({
    prompt: 'Middleware class name',
    placeHolder: 'RequireLogin',
    validateInput: (value) => (/^[A-Za-z_]\w*$/.test(value) ? undefined : 'Enter a valid Python class name'),
  });
  if (!className) return;

  const body = [
    'from sillo import BaseMiddleware',
    '',
    '',
    `class ${className}(BaseMiddleware):`,
    '    async def dispatch(self, ctx, call_next):',
    '        response = await call_next()',
    '        return response',
    '',
  ].join('\n');

  const target = vscode.Uri.joinPath(folders[0].uri, 'middleware', `${toSnakeCase(className)}.py`);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folders[0].uri, 'middleware'));
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
  const document = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(document);
}

async function createApp(): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: 'New Sillo app name',
    placeHolder: 'myapp',
    validateInput: (value) => (/^[A-Za-z][\w-]*$/.test(value) ? undefined : 'Use a letter followed by letters, digits, hyphens or underscores'),
  });
  if (!name) return;

  const folders = vscode.workspace.workspaceFolders;
  const cwd = folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  const createCommand = vscode.workspace.getConfiguration('sillo').get<string>('createAppCommand', 'uvx sillo-start');

  const terminal = vscode.window.createTerminal({ name: `Sillo: ${name}`, cwd });
  terminal.show();
  terminal.sendText(`${createCommand} create-app ${name}`.trim());
}

async function showBestPractices(context: vscode.ExtensionContext): Promise<void> {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'docs', 'best-practices.md');
  await vscode.commands.executeCommand('markdown.showPreview', uri);
}

export function activate(context: vscode.ExtensionContext): void {
  registerDiagnostics(context);

  const structureProvider = new SilloStructureProvider();
  const codeLensProvider = new RouteCodeLensProvider();

  const refreshAll = () => {
    structureProvider.refresh();
    codeLensProvider.refresh();
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.py');
  watcher.onDidChange(refreshAll);
  watcher.onDidCreate(refreshAll);
  watcher.onDidDelete(refreshAll);

  // CodeLenses are scanned from the live buffer (see requestRunner.ts), so
  // they need to refresh as you type, not only once the file is saved.
  let codeLensRefreshTimer: NodeJS.Timeout | undefined;
  const scheduleCodeLensRefresh = (document: vscode.TextDocument) => {
    if (document.languageId !== 'python') return;
    clearTimeout(codeLensRefreshTimer);
    codeLensRefreshTimer = setTimeout(() => codeLensProvider.refresh(), 250);
  };

  context.subscriptions.push(
    watcher,
    vscode.window.registerTreeDataProvider('sillo.structure', structureProvider),
    vscode.languages.registerCodeLensProvider(PYTHON, codeLensProvider),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleCodeLensRefresh(e.document)),

    vscode.languages.registerHoverProvider(PYTHON, new CtxHoverProvider()),
    vscode.languages.registerCompletionItemProvider(PYTHON, new CtxCompletionProvider(), '.'),
    vscode.languages.registerCompletionItemProvider(PYTHON, new ModelKwargCompletionProvider(), '='),
    vscode.languages.registerDefinitionProvider(PYTHON, new ValidatedDataDefinitionProvider()),

    vscode.commands.registerCommand('sillo.refreshStructure', refreshAll),
    vscode.commands.registerCommand('sillo.runRoute', runRoute),
    vscode.commands.registerCommand('sillo.previewApplication', previewApplication),
    vscode.commands.registerCommand('sillo.openApiDocs', openApiDocs),
    vscode.commands.registerCommand('sillo.newMiddleware', newMiddleware),
    vscode.commands.registerCommand('sillo.createApp', createApp),
    vscode.commands.registerCommand('sillo.showBestPractices', () => showBestPractices(context)),

    vscode.commands.registerCommand('sillo.runCommand', runCommandPicker),
    vscode.commands.registerCommand('sillo.listRoutes', () => runInTerminal('routes')),
    vscode.commands.registerCommand('sillo.dbMake', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Migration name', placeHolder: 'add_users' });
      if (name) runInTerminal(`db:make ${name}`);
    }),
    vscode.commands.registerCommand('sillo.dbMigrate', () => runInTerminal('db:migrate')),
    vscode.commands.registerCommand('sillo.dbStatus', () => runInTerminal('db:status')),
    vscode.commands.registerCommand('sillo.dbRollback', async () => {
      const target = await vscode.window.showInputBox({
        prompt: 'Rollback target (leave empty for the last migration)',
      });
      runInTerminal(`db:rollback ${target ?? ''}`.trim());
    }),
    vscode.commands.registerCommand('sillo.queueWork', () => runInTerminal('queue:work'))
  );
}

export function deactivate(): void {}
