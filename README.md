# Sillo for VS Code

IDE support for the [Sillo](https://sillo.build) Python web framework.

## Features

- **Route actions and output** — every HTTP route has an inline `Run` CodeLens
  action. Responses are printed in the **Sillo** Output channel. No webview,
  sidebar, or editor tab is opened.
- **Inline wiring warnings** — a warning appears on a router that was defined
  but not mounted with `application.mount_router(router)`, or a middleware
  class that has not been registered with `.use(...)`.
- **Configure Project** — a workspace-scoped command for the development
  server, request URL, and application entry. Set an application entry when
  your project does not declare `[tool.sillo] app`; it enables the wiring
  audit that checks mounted routers and registered middleware. The full
  Settings UI remains one click away.

- **`ctx.` IntelliSense** — completions and hover docs for every member of
  `HttpContext`, the single argument every Sillo handler receives (`ctx.json`,
  `ctx.query_params`, `ctx.url_for(...)`, and so on).
- **Snippets** — `sillo-simple` (a whole basic app in one file), `sillo-router`,
  `sillo-get`, `sillo-post`, `sillo-route-param`, `sillo-handler`, `sillo-model`,
  `sillo-pydantic`, `sillo-middleware`, `sillo-json`, `sillo-redirect`.
- **Project-aware, not workspace-wide** — the base
  URL, the dev-server command) is scoped to whichever Sillo project the
  active file belongs to — found the same way `sillo`'s own CLI finds an
  app: the nearest `pyproject.toml`'s `[tool.sillo] app`, or the
  `app.main:app` / `main:app` / `app:app` guesses it falls back to. This
  matters in a workspace that holds more than one Sillo project (a
  monorepo, or just a few side by side) — a workspace-wide scan would mix
  their routes/models together with no indication which project they're from.
- **`sillo.baseUrl` / `sillo.devServerCommand` auto-detect** — the development
  command defaults to `uv run sillo dev`, while the base URL defaults to
  `127.0.0.1:8000` only as a last
  resort. Left unset, the base URL is read from the project's own
  `HOST`/`PORT` (`.env`, falling back to `app/config.py`'s field defaults),
  so testing a route against the URL it's actually served on doesn't require
  it to happen to be on port 8000.
- **`Sillo: Preview Application`** — runs `uv run sillo dev` and opens the app
  in VS Code's Simple Browser.
- **`Sillo: Open API Docs`** — opens the app's Swagger UI (`/docs` by
  default, see `sillo.docsPath`) the same way.
- **`request_model=`/`response_model=` completion** — suggests Pydantic
  model classes found in the file as you type either kwarg.
- **Go to definition on `ctx.validated_data`** — jumps to the route's
  `request_model` class.
- **`Sillo: New Middleware...`** and **`Sillo: Create Sillo App...`** —
  scaffolding commands.
- **Best-practice diagnostics** — red squiggles for things that are wrong,
  not just unconventional: `app.run()` in application code, `ctx.db`
  (doesn't exist), and `ctx.json(...)`/`ctx.redirect(...)` called as if they
  were response builders. Routing directly on the app (`@app.get(...)`) is
  fine and not flagged. See `Sillo: Show Best Practices` for why.
- **CLI shortcuts** in the Command Palette (`Sillo: ...`) that run the Sillo
  CLI in an integrated terminal: list routes, make/run/rollback migrations,
  check migration status, start a queue worker, or run any other CLI command
  via `Sillo: Run CLI Command...`.

## Requirements

None — the extension works against plain Python files and does not require
a Python language server or a local Sillo install to provide snippets and
`ctx` IntelliSense. The CLI commands do need a working `sillo` command on
your `PATH` (or set `sillo.cliCommand`, e.g. to `"uv run sillo"`).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `sillo.cliCommand` | `sillo` | The command used to invoke the Sillo CLI. |
