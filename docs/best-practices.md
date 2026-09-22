# Sillo Best Practices

What this extension's diagnostics (the red squiggles) actually check, and why.
Each rule below is enforced by `src/diagnostics.ts` and cites the source it's
grounded in — these are not style opinions invented for this document.

## 1. Register routes through a `Router`, not on the app directly

```python
# Flagged
app = SilloApp(title="My API")

@app.get("/users/{id:int}")
async def get_user(ctx: HttpContext): ...
```

```python
# Preferred
app = SilloApp(title="My API")
router = Router(prefix="/users")

@router.get("/{id:int}")
async def get_user(ctx: HttpContext): ...

app.mount_router(router)
```

`SilloApp` does expose `.get()/.post()/.../.patch()` directly, and the
framework's own quick-start example in `sillo/__init__.py` uses it for a
single toy route. But once an app has more than one or two handlers, decorating
the app instance directly means every route lives in one growing module with
no shared prefix, tags or per-router middleware — a `Router`, mounted with
`app.mount_router(...)`, is what the starter kit itself uses for everything
past the single top-level page. Prefer it from the first route.

## 2. Don't call `app.run()`

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

## 3. There is no `ctx.db`

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

## 4. Responses are built by free functions, not `ctx` methods

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
