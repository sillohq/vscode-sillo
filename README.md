# Sillo for VS Code

IDE support for the [Sillo](https://sillo.build) Python web framework.

## Features

- **`ctx.` IntelliSense** — completions and hover docs for every member of
  `HttpContext`, the single argument every Sillo handler receives (`ctx.json`,
  `ctx.query_params`, `ctx.url_for(...)`, and so on).
- **Snippets** — `sillo-simple` (a whole basic app in one file), `sillo-router`,
  `sillo-get`, `sillo-post`, `sillo-route-param`, `sillo-handler`, `sillo-model`,
  `sillo-pydantic`, `sillo-middleware`, `sillo-json`, `sillo-redirect`.
- **Sidebar view** (the Sillo icon in the Activity Bar) — an Application
  Structure tree of Routers, routes, Models, Middleware, Jobs and
  Migrations, auto-refreshed on save.
  - Each route has two inline buttons: open its definition, or try it in
    the HTTP client.
  - Each model has a "View Table Data" button that opens the DB viewer
    straight to its table (`Meta.table` if set, else Tortoise's own
    default — the class name lowercased).
  - Middleware shows both what's defined in the project (`class X(BaseMiddleware)`)
    and what's actually wired into the app via `.use(...)` — which, for
    most projects, is mainly framework built-ins (`CORSMiddleware`,
    `SessionMiddleware`, `AuthenticationMiddleware`, ...) that have no
    local class declaration to find otherwise.
- **Project-aware, not workspace-wide** — everything (the tree, the base
  URL, the dev-server command) is scoped to whichever Sillo project the
  active file belongs to — found the same way `sillo`'s own CLI finds an
  app: the nearest `pyproject.toml`'s `[tool.sillo] app`, or the
  `app.main:app` / `main:app` / `app:app` guesses it falls back to. This
  matters in a workspace that holds more than one Sillo project (a
  monorepo, or just a few side by side) — a workspace-wide scan would mix
  their routes/models together with no indication which project they're
  from, and a hardcoded base URL doesn't know which project's `.env` to
  read anyway.
- **`sillo.baseUrl` / `sillo.devServerCommand` auto-detect** — both default
  to `127.0.0.1:8000` / `uvicorn app.main:app --reload` only as a last
  resort. Left unset, the base URL is read from the project's own
  `HOST`/`PORT` (`.env`, falling back to `app/config.py`'s field defaults),
  and the dev command from its real app entry point — so testing a route
  against the URL it's actually served on doesn't require it to happen to
  be on port 8000.
- **Click-to-try routes** — a "▶ Try ..." CodeLens above every route
  decorator that opens a small HTTP client webview prefilled with the
  method and URL — edit headers/body/path placeholders and hit Send.
- **Database viewer** (`Sillo: Open Database Viewer`) — SQLite and
  PostgreSQL. Finds the project's database by reading `sqlite://`/
  `postgres://` out of `.env`/`app/config.py`, or for SQLite, falling back
  to a single `*.db`/`*.sqlite`/`*.sqlite3` file under `storage/`. Set
  `sillo.databaseUrl` (either scheme) or `sillo.databasePath` (SQLite) to
  skip detection and point at it directly. Needs `sqlite3` or `psql` on
  your PATH depending on which engine it finds.
- **`Sillo: Preview Application`** — runs the dev server and opens the app
  in VS Code's Simple Browser.
- **`Sillo: Open API Docs`** — opens the app's Swagger UI (`/docs` by
  default, see `sillo.docsPath`) the same way.
- **`request_model=`/`response_model=` completion** — suggests Pydantic
  model classes found in the file as you type either kwarg.
- **Go to definition on `ctx.validated_data`** — jumps to the route's
  `request_model` class.
- **Migrations** in the sidebar tree, listing migration files on disk (not
  which are applied — that needs a DB connection, so use
  `Sillo: Migration Status` for that).
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
