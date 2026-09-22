# Sillo Best Practices

What this extension's diagnostics (the red squiggles) actually check, and why.
Each rule below is enforced by `src/diagnostics.ts` and cites the source it's
grounded in — these are not style opinions invented for this document.

Routing directly on the app (`@app.get(...)`) is deliberately not one of
these rules — it's exactly what the framework's own quick-start example in
`sillo/__init__.py` does, and it's a fine way to write a Sillo app. `Router`
+ `mount_router(...)` is there for when you want a shared prefix or
per-router middleware, not because decorating the app is wrong.

## 1. Don't call `app.run()`

```python
# Flagged
app.run()
```

```python
# Preferred
# uvicorn app.main:app --reload
```

This isn't a style preference — `SilloApp.run()` (`sillo/application.py`)
raises a `UserWarning` every time it's called: *"app.run() is inefficient and
only for testing. For development and production, use: uvicorn app:app ...
or granian app:app ..."*. The warning is the framework telling you directly.

## 2. There is no `ctx.db`

```python
# Flagged
async def list_users(ctx: HttpContext):
    return json(await ctx.db.query(User))
```

```python
# Preferred
async def list_users(ctx: HttpContext):
    return json(await User.objects.all())
```

`HttpContext` (`sillo/core/http/context.py`) has no `db` attribute. Database
access goes through a model's own manager (`User.objects...`), not through
`ctx`. This one is a plain `AttributeError` waiting to happen, not a style
choice.

## 3. Responses are built by free functions, not `ctx` methods

```python
# Flagged
async def handler(ctx: HttpContext):
    return ctx.json({"ok": True})
```

```python
# Preferred
from sillo import json

async def handler(ctx: HttpContext):
    return json({"ok": True})
```

`ctx.json` *is* a real attribute — but it's the parsed request body
(`await ctx.json`), not a response builder. Responses come from the standalone
functions in `sillo`/`sillo.responses`: `json`, `html`, `text`, `redirect`,
`file`, `stream`. Calling `ctx.json(...)`, `ctx.redirect(...)` etc. as if they
built a response is a mix-up between the two, and fails at runtime.
