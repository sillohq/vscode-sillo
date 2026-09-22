import * as vscode from 'vscode';
import { sendRequest, formatBody } from './http';

/**
 * A small, single-request HTTP client webview — enough to try a route
 * without leaving the editor. Not a Postman replacement: no collections, no
 * history, one request at a time.
 */
export class HttpClientPanel {
  private static current: HttpClientPanel | undefined;

  private readonly panel: vscode.WebviewPanel;

  private constructor(context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      'sillo.httpClient',
      'Sillo HTTP Client',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png');
    this.panel.webview.html = this.render();

    this.panel.onDidDispose(() => {
      if (HttpClientPanel.current === this) HttpClientPanel.current = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type !== 'send') return;
      const { requestId, method, url, headers, body } = message;
      try {
        const parsedUrl = new URL(url);
        const response = await sendRequest(parsedUrl, method, headers, body || undefined);
        this.panel.webview.postMessage({
          type: 'response',
          requestId,
          status: response.status,
          headers: response.headers,
          body: formatBody(response.body, String(response.headers['content-type'] ?? '')),
        });
      } catch (err) {
        this.panel.webview.postMessage({
          type: 'error',
          requestId,
          message: (err as Error).message,
        });
      }
    });
  }

  static showRoute(context: vscode.ExtensionContext, method: string, url: string): void {
    if (!HttpClientPanel.current) {
      HttpClientPanel.current = new HttpClientPanel(context);
    }
    const instance = HttpClientPanel.current;
    instance.panel.reveal(vscode.ViewColumn.Beside, true);
    instance.panel.webview.postMessage({ type: 'prefill', method, url });
  }

  private render(): string {
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
    padding: 12px 16px 24px;
  }
  .row { display: flex; gap: 8px; margin-bottom: 10px; }
  select, input[type=text], textarea {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    padding: 5px 8px;
  }
  select { flex: 0 0 auto; }
  #url { flex: 1 1 auto; }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 3px;
    padding: 5px 14px;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  label { display: block; font-size: 11px; text-transform: uppercase; opacity: 0.7; margin: 14px 0 4px; }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; }
  #headers { height: 60px; }
  #body { height: 120px; }
  #response { white-space: pre-wrap; word-break: break-all; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  #status { font-weight: 600; }
  #status.ok { color: var(--vscode-testing-iconPassed, #2ea043); }
  #status.err { color: var(--vscode-testing-iconFailed, #f14c4c); }
  .hint { opacity: 0.6; font-size: 11px; margin-top: 4px; }
</style>
</head>
<body>
  <div class="row">
    <select id="method">
      <option>GET</option>
      <option>POST</option>
      <option>PUT</option>
      <option>PATCH</option>
      <option>DELETE</option>
    </select>
    <input type="text" id="url" placeholder="http://127.0.0.1:8000/path" />
    <button id="send">Send</button>
  </div>

  <label for="headers">Headers (one "Key: Value" per line)</label>
  <textarea id="headers" placeholder="Content-Type: application/json"></textarea>

  <label for="body">Body</label>
  <textarea id="body" placeholder='{"key": "value"}'></textarea>
  <div class="hint">Edit any <code>{param}</code> placeholders in the URL before sending.</div>

  <label>Response <span id="status"></span></label>
  <div id="response"></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const methodEl = document.getElementById('method');
  const urlEl = document.getElementById('url');
  const headersEl = document.getElementById('headers');
  const bodyEl = document.getElementById('body');
  const statusEl = document.getElementById('status');
  const responseEl = document.getElementById('response');

  let requestId = 0;

  function parseHeaders(text) {
    const headers = {};
    for (const line of text.split('\\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) headers[key] = value;
    }
    return headers;
  }

  document.getElementById('send').addEventListener('click', () => {
    requestId += 1;
    statusEl.textContent = 'sending…';
    statusEl.className = '';
    responseEl.textContent = '';
    vscode.postMessage({
      type: 'send',
      requestId,
      method: methodEl.value,
      url: urlEl.value,
      headers: parseHeaders(headersEl.value),
      body: methodEl.value === 'GET' || methodEl.value === 'DELETE' ? undefined : bodyEl.value,
    });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'prefill') {
      methodEl.value = message.method;
      urlEl.value = message.url;
      if (message.method !== 'GET' && message.method !== 'DELETE' && !headersEl.value) {
        headersEl.value = 'Content-Type: application/json';
      }
      return;
    }
    if (message.requestId !== requestId) return;
    if (message.type === 'error') {
      statusEl.textContent = 'error';
      statusEl.className = 'err';
      responseEl.textContent = message.message;
      return;
    }
    if (message.type === 'response') {
      statusEl.textContent = String(message.status);
      statusEl.className = message.status < 400 ? 'ok' : 'err';
      const headerLines = Object.entries(message.headers)
        .map(([k, v]) => k + ': ' + v)
        .join('\\n');
      responseEl.textContent = headerLines + '\\n\\n' + message.body;
    }
  });
</script>
</body>
</html>`;
  }
}
