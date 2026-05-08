# what7

A local browse / preview / share product layer for Codex sessions. `what7` is the human companion to `cxs`: `cxs` owns the recall index, `what7` gives you a web app on top that lets you find a past conversation, read it cleanly, pin the views you care about, and publish a shareable read-only page through a Cloudflare Worker.

> `cxs` is the agent-facing recall infrastructure. `what7` reuses that index (`~/.local/state/cxs/index.sqlite`) read-only and adds a human surface. **It does not rebuild another index.**

## Quickstart

```bash
npm install
npm run build            # backend → dist/
cd web && npm install && npm run build   # frontend → web/dist/
cd ..

# optional: enable public sharing (Cloudflare Worker)
source .what7/deploy.env

what7 serve
```

`what7 serve` opens `http://127.0.0.1:<port>/` with the full workbench: projects in the left rail, session list in the middle, reading pane on the right. The server only binds `127.0.0.1` and does not authenticate — this is a single-user local tool.

If `what7` is not on your `PATH`, replace it with `node dist/cli.js`.

## What the app does

- **Recent**: global session list, time-bucketed (Today / Yesterday / This week / Earlier).
- **Projects**: every `cwd` from `cxs` that you've worked in, short `basename` slug. Hidden projects collapse into `Show hidden (n)`.
- **Search** (`/search`): a chip bar with query, time window (1d/7d/30d/All), `Shared only` toggle, and project picker. All state lives in the URL `?q=&since=&project=&shared=` so every search is a linkable, pinnable URL.
- **Published** (`/published`): everything you've shared, same chip bar as search with `shared=1` on by default.
- **Settings** (`/settings`): per-project `displayName` alias and `hidden` toggle, default landing route, theme.
- **Shortcuts**: the `+` button in the sidebar pins whatever URL you're currently on. Internal URLs are probed on load; dead ones go grey with a tooltip.
- **Share**: any session has a `Share` action that renders a clean standalone HTML and publishes it to your Worker. Delete capability is stored locally so you can always `unpublish`.

The reading pane is a session-level structured view — tool calls, reasoning, and events are hidden by default to match the shared-page experience.

## CLI

`what7` is mostly the web app. The CLI covers ops:

| Command | What it does |
|---|---|
| `what7 serve [--port] [--no-open]` | Start the local web workbench. Primary entry point. |
| `what7 sync` | Delegate to `cxs sync` to refresh the SQLite index. |
| `what7 list [--json]` | Show publish history (useful in cron / automation). |
| `what7 unpublish <id-or-url>` | Retract a public share using the local delete capability. Works without the web running. |
| `what7 doctor [--json]` | Check cxs db, state dir, worker env, web build. |

All commands accept `--json` for machine-readable output. `--state-dir <dir>` overrides the persistence location (else `WHAT7_STATE_DIR`, `$XDG_STATE_HOME/what7`, or `~/Library/Application Support/what7` on macOS).

## Local state

Everything `what7` writes goes into a single `state.json`:

```
<state-dir>/
  state.json        # publish history + shortcuts + project prefs
  html/             # cached share HTML (source of truth for unpublish)
```

`state.json` schema:

```jsonc
{
  "version": 1,
  "records":   [ /* PublishRecord[] */ ],  // publish history
  "shortcuts": [ /* Shortcut[]      */ ],  // sidebar pins
  "projects":  [ /* ProjectPref[]   */ ]   // displayName + hidden per cwd
}
```

The cxs SQLite index (`~/.local/state/cxs/index.sqlite`) is owned entirely by `cxs`. `what7` opens it read-only and never writes.

## Cloudflare Worker (sharing)

Sharing requires a small Worker that holds the published HTML. It lives under `worker/`.

```bash
# once
npx wrangler kv namespace create WHAT7_SHARES
# paste the returned id into worker/wrangler.jsonc

npx wrangler secret put WHAT7_ADMIN_TOKEN --config worker/wrangler.jsonc
npx wrangler deploy --config worker/wrangler.jsonc
```

Export the env so `what7` can publish:

```bash
export WHAT7_WORKER_URL="https://what7-share.<your-subdomain>.workers.dev"
export WHAT7_ADMIN_TOKEN="<secret from wrangler secret put>"
```

`what7 doctor` will show whether these are set and whether a build is ready.

For local worker development see `docs/deployment.md`.

## Shared pages are clean by default

The public share page hides tool calls, reasoning, events, and metadata. Debug layers are opt-in via URL query params:

```
?tools=1   ?context=1   ?events=1   ?reasoning=1   ?debug=1   # all of the above
```

Default render also runs a redaction pass for common secret shapes (API keys, tokens, env exports). Review the preview before sharing anything sensitive.

## Boundaries

- **Not a second recall backend.** `cxs` owns the index. `what7` reads it.
- **No auth on the local server.** `127.0.0.1` only. If you want token auth or remote access, that's v2 scope.
- **Share pages are anonymous.** Anyone with the URL can read. Use `what7 unpublish` or the web `Unpublish` action to retract.
- **Delete capability lives locally.** The worker only stores a hash. Lose the local `state.json` and you lose the ability to unpublish.

## Development

```bash
npm run verify          # typecheck + test + build (backend)
cd web && npm run build # type-check + vite build
```

Tests are in `tests/`, using vitest + fixture cxs SQLite (no network, no real `~/.codex`).

## Links

- PRD: `docs/prd-v1.md` — product decisions and milestones
- Design: `docs/design-spec.md` — UI tokens and slices
- Deployment: `docs/deployment.md` — worker ops details
- Architecture sketch: `docs/design.md`
