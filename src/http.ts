import * as http from 'node:http';
import * as https from 'node:https';

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export function sendRequest(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<HttpResponse> {
  const transport = url.protocol === 'https:' ? https : http;
  const outHeaders: http.OutgoingHttpHeaders = { ...headers };
  if (body && !Object.keys(outHeaders).some((h) => h.toLowerCase() === 'content-length')) {
    outHeaders['content-length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(url, { method, headers: outHeaders }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => req.destroy(new Error('Request timed out after 15s')));
    if (body) req.write(body);
    req.end();
  });
}

export function formatBody(body: string, contentType?: string): string {
  if (contentType && !/json/.test(contentType) && !body.trimStart().startsWith('{') && !body.trimStart().startsWith('[')) {
    return body;
  }
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
