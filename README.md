# Sillo for VS Code

IDE support for the [Sillo](https://sillo.build) Python web framework.

## Features

- **`ctx.` IntelliSense** — completions and hover docs for every member of
  `HttpContext`, the single argument every Sillo handler receives (`ctx.json`,
  `ctx.query_params`, `ctx.url_for(...)`, and so on).
- **Snippets** — `sillo-router`, `sillo-get`, `sillo-post`, `sillo-route-param`,
  `sillo-handler`, `sillo-model`, `sillo-pydantic`, `sillo-json`, `sillo-redirect`.
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
