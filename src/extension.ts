import * as vscode from 'vscode';
import { CTX_MEMBERS } from './ctxApi';

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

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(PYTHON, new CtxHoverProvider()),
    vscode.languages.registerCompletionItemProvider(PYTHON, new CtxCompletionProvider(), '.'),

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
