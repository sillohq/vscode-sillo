import * as vscode from 'vscode';
import { findDatabase, sqlite3Available, listTables, queryTable } from './db';

export class DbViewerPanel {
  private static current: DbViewerPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private dbPath: string | undefined;

  private constructor(context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      'sillo.dbViewer',
      'Sillo Database',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png');

    this.panel.onDidDispose(() => {
      if (DbViewerPanel.current === this) DbViewerPanel.current = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === 'loadTable' && this.dbPath) {
        try {
          const data = await queryTable(this.dbPath, message.table);
          this.panel.webview.postMessage({ type: 'table', table: message.table, ...data });
        } catch (err) {
          this.panel.webview.postMessage({ type: 'error', message: (err as Error).message });
        }
      }
    });
  }

  static async show(context: vscode.ExtensionContext, initialTable?: string): Promise<void> {
    if (!(await sqlite3Available())) {
      vscode.window.showErrorMessage(
        'Sillo: the "sqlite3" command isn\'t on your PATH. Install it (e.g. via your OS package manager) to use the database viewer.'
      );
      return;
    }

    const location = await findDatabase();
    if (location.kind === 'not-found') {
      vscode.window.showErrorMessage(
        'Sillo: couldn\'t find a sqlite:// DATABASE_URL in .env / config.py in this workspace.'
      );
      return;
    }
    if (location.kind === 'unsupported') {
      vscode.window.showErrorMessage(
        `Sillo: the database viewer only supports SQLite right now, and this project's DATABASE_URL uses "${location.scheme}://". Use a proper DB client for that.`
      );
      return;
    }

    if (!DbViewerPanel.current) {
      DbViewerPanel.current = new DbViewerPanel(context);
    }
    const instance = DbViewerPanel.current;
    instance.dbPath = location.path;
    instance.panel.reveal(vscode.ViewColumn.Beside, true);
    instance.panel.webview.html = instance.render(location.path);

    try {
      const tables = await listTables(location.path);
      if (initialTable && !tables.includes(initialTable)) {
        vscode.window.showWarningMessage(
          `Sillo: no table named "${initialTable}" in this database (checked Meta.table, and the class name lowercased as a fallback). Showing the table list instead.`
        );
      }
      instance.panel.webview.postMessage({
        type: 'tables',
        tables,
        select: initialTable && tables.includes(initialTable) ? initialTable : undefined,
      });
    } catch (err) {
      instance.panel.webview.postMessage({ type: 'error', message: (err as Error).message });
    }
  }

  private render(dbPath: string): string {
    const nonce = Array.from({ length: 16 }, () => Math.random().toString(36)[2]).join('');
    return /* html */ `<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    display: flex;
    height: 100vh;
  }
  #sidebar {
    width: 200px;
    flex: 0 0 auto;
    overflow-y: auto;
    border-right: 1px solid var(--vscode-panel-border);
    padding: 8px 0;
  }
  #sidebar .path {
    font-size: 10px;
    opacity: 0.6;
    padding: 0 12px 8px;
    word-break: break-all;
  }
  #sidebar button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    padding: 5px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  #sidebar button:hover, #sidebar button.active {
    background: var(--vscode-list-hoverBackground);
  }
  #main {
    flex: 1 1 auto;
    overflow: auto;
    padding: 8px 16px;
  }
  table { border-collapse: collapse; font-size: 12px; width: max-content; }
  th, td {
    border: 1px solid var(--vscode-panel-border);
    padding: 4px 10px;
    white-space: pre;
    text-align: left;
  }
  th { background: var(--vscode-editor-inactiveSelectionBackground); position: sticky; top: 0; }
  #empty { opacity: 0.6; padding: 8px 0; }
</style>
</head>
<body>
  <div id="sidebar">
    <div class="path">${dbPath}</div>
    <div id="tables"></div>
  </div>
  <div id="main"><div id="empty">Pick a table.</div></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const tablesEl = document.getElementById('tables');
  const mainEl = document.getElementById('main');
  let activeButton = null;

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'tables') {
      tablesEl.innerHTML = '';
      let selectButton = null;
      for (const table of message.tables) {
        const button = document.createElement('button');
        button.textContent = table;
        button.addEventListener('click', () => {
          if (activeButton) activeButton.classList.remove('active');
          button.classList.add('active');
          activeButton = button;
          mainEl.innerHTML = 'Loading…';
          vscode.postMessage({ type: 'loadTable', table });
        });
        tablesEl.appendChild(button);
        if (table === message.select) selectButton = button;
      }
      if (selectButton) selectButton.click();
      return;
    }
    if (message.type === 'error') {
      mainEl.textContent = message.message;
      return;
    }
    if (message.type === 'table') {
      if (message.rows.length === 0) {
        mainEl.innerHTML = '<div id="empty">No rows.</div>';
        return;
      }
      const table = document.createElement('table');
      const thead = document.createElement('tr');
      for (const col of message.columns) {
        const th = document.createElement('th');
        th.textContent = col;
        thead.appendChild(th);
      }
      table.appendChild(thead);
      for (const row of message.rows) {
        const tr = document.createElement('tr');
        for (const cell of row) {
          const td = document.createElement('td');
          td.textContent = cell;
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      mainEl.innerHTML = '';
      mainEl.appendChild(table);
    }
  });
</script>
</body>
</html>`;
  }
}
