/**
 * Known members of `sillo.core.http.context.HttpContext`, the single `ctx`
 * argument every Sillo handler receives.
 *
 * Kept as data (not derived from the framework at runtime) so the extension
 * has no dependency on the user's Python environment. Sourced from
 * sillo/core/http/context.py in the 1.0 core — verify against that file
 * when the framework's ctx surface changes.
 */
export interface CtxMember {
  name: string;
  /** How it's used, e.g. "ctx.method" or "await ctx.json". */
  signature: string;
  detail: string;
  kind: 'property' | 'method' | 'awaitable';
}

export const CTX_MEMBERS: CtxMember[] = [
  { name: 'method', signature: 'ctx.method', detail: 'The HTTP method of the request, e.g. "GET".', kind: 'property' },
  { name: 'url', signature: 'ctx.url', detail: 'The full request URL.', kind: 'property' },
  { name: 'base_url', signature: 'ctx.base_url', detail: 'The scheme, host and port of the request, with no path.', kind: 'property' },
  { name: 'path', signature: 'ctx.path', detail: 'The URL path, without the query string.', kind: 'property' },
  { name: 'headers', signature: 'ctx.headers', detail: 'The request headers.', kind: 'property' },
  { name: 'query_params', signature: 'ctx.query_params', detail: 'The parsed query string parameters.', kind: 'property' },
  { name: 'path_params', signature: 'ctx.path_params', detail: 'Dict of values captured from the route path, e.g. {"id:int"}.', kind: 'property' },
  { name: 'cookies', signature: 'ctx.cookies', detail: 'The request cookies.', kind: 'property' },
  { name: 'client', signature: 'ctx.client', detail: 'The connecting client\'s Address, or None.', kind: 'property' },
  { name: 'state', signature: 'ctx.state', detail: 'Shared app State — where things like the record manager live.', kind: 'property' },
  { name: 'app', signature: 'ctx.app', detail: 'The router this handler was registered on.', kind: 'property' },
  { name: 'base_app', signature: 'ctx.base_app', detail: 'The root SilloApp, regardless of which router matched.', kind: 'property' },

  { name: 'body', signature: 'await ctx.body', detail: 'The raw request body as bytes.', kind: 'awaitable' },
  { name: 'json', signature: 'await ctx.json', detail: 'The request body parsed as JSON (dict).', kind: 'awaitable' },
  { name: 'text', signature: 'await ctx.text', detail: 'The request body decoded as text.', kind: 'awaitable' },
  { name: 'form', signature: 'await ctx.form', detail: 'The parsed form data (FormData).', kind: 'awaitable' },
  { name: 'form_data', signature: 'ctx.form_data', detail: 'Awaitable / async-context-manager form of the above.', kind: 'awaitable' },
  { name: 'files', signature: 'await ctx.files', detail: 'Uploaded files, keyed by field name.', kind: 'awaitable' },
  { name: 'validated_data', signature: 'ctx.validated_data', detail: 'The instance produced by this route\'s request_model validation.', kind: 'property' },

  { name: 'content_type', signature: 'ctx.content_type', detail: 'The Content-Type header.', kind: 'property' },
  { name: 'content_length', signature: 'ctx.content_length', detail: 'The Content-Length header, parsed as int.', kind: 'property' },
  { name: 'is_json', signature: 'ctx.is_json', detail: 'True if the request body is JSON.', kind: 'property' },
  { name: 'is_form', signature: 'ctx.is_form', detail: 'True if the request body is form-encoded (any kind).', kind: 'property' },
  { name: 'is_multipart', signature: 'ctx.is_multipart', detail: 'True if the request is multipart/form-data.', kind: 'property' },
  { name: 'is_urlencoded', signature: 'ctx.is_urlencoded', detail: 'True if the request is application/x-www-form-urlencoded.', kind: 'property' },
  { name: 'is_ajax', signature: 'ctx.is_ajax', detail: 'True if this looks like an XHR/fetch request.', kind: 'property' },
  { name: 'is_secure', signature: 'ctx.is_secure', detail: 'True if the request was made over HTTPS.', kind: 'property' },
  { name: 'has_cookie', signature: 'ctx.has_cookie', detail: 'True if the request carries any cookies.', kind: 'property' },
  { name: 'has_files', signature: 'ctx.has_files', detail: 'True if the request has file uploads.', kind: 'property' },
  { name: 'has_body', signature: 'ctx.has_body', detail: 'True if the request has a body.', kind: 'property' },
  { name: 'has_session', signature: 'ctx.has_session', detail: 'True if a session is active for this request.', kind: 'property' },
  { name: 'accepts_html', signature: 'ctx.accepts_html', detail: 'True if the client\'s Accept header allows HTML.', kind: 'property' },
  { name: 'accepts_json', signature: 'ctx.accepts_json', detail: 'True if the client\'s Accept header allows JSON.', kind: 'property' },

  { name: 'session', signature: 'ctx.session', detail: 'The session. Raises AssertionError unless SessionMiddleware is installed.', kind: 'property' },
  { name: 'user', signature: 'ctx.user', detail: 'The authenticated user. Raises ValueError unless AuthenticationMiddleware is installed.', kind: 'property' },
  { name: 'is_authenticated', signature: 'ctx.is_authenticated', detail: 'True if ctx.user is set.', kind: 'property' },

  { name: 'url_for', signature: 'ctx.url_for(name, **path_params)', detail: 'Build a URL for a named route.', kind: 'method' },
  { name: 'build_absolute_uri', signature: 'ctx.build_absolute_uri(path, query_params=None)', detail: 'Build an absolute URI relative to this request.', kind: 'method' },
  { name: 'get_client_ip', signature: 'ctx.get_client_ip()', detail: 'The connecting client\'s IP address.', kind: 'method' },
  { name: 'get_header', signature: 'ctx.get_header(key, default=None)', detail: 'Look up a request header case-insensitively.', kind: 'method' },
  { name: 'has_header', signature: 'ctx.has_header(key)', detail: 'True if the given header is present.', kind: 'method' },
  { name: 'is_method', signature: 'ctx.is_method(method)', detail: 'True if the request method matches (case-insensitive).', kind: 'method' },
  { name: 'get_query_params', signature: 'ctx.get_query_params(flat=True)', detail: 'The query string as a dict; flat=False keeps repeated keys as lists.', kind: 'method' },

  { name: 'stream', signature: 'async for chunk in ctx.stream()', detail: 'Stream the request body in chunks.', kind: 'method' },
  { name: 'close', signature: 'await ctx.close()', detail: 'Close the underlying connection.', kind: 'method' },
  { name: 'is_disconnected', signature: 'await ctx.is_disconnected()', detail: 'True if the client has disconnected.', kind: 'method' },
  { name: 'send_push_promise', signature: 'await ctx.send_push_promise(path)', detail: 'Send an HTTP/2 push promise for the given path.', kind: 'method' },
];

/**
 * There is deliberately no `ctx.db` — responses go through the standalone
 * functions in `sillo.responses` (json, redirect, html, text, xml, ...),
 * and database access goes through a model's own manager (e.g.
 * `User.objects...`), not through ctx. Both are surfaced as snippets
 * instead of ctx completions, since they aren't ctx members.
 */
export const CTX_NOTE =
  "No ctx.db or ctx.json()/ctx.redirect() — build responses with sillo.responses.json/redirect/html/text, and query models directly (e.g. User.objects...).";
