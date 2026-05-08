# what7 design

`what7` is a local human workbench on top of the cxs SQLite session index, plus a Cloudflare Worker for public read-only share pages. v1 is single-user, localhost-only, unauthenticated. See `prd-v1.md` for product decisions; this file is the implementation map.

## Boundaries

- `cxs` owns the SQLite index at `~/.local/state/cxs/index.sqlite`. what7 opens it **read-only**.
- what7's own persistence lives in one `state.json` (publish history + shortcuts + per-project prefs).
- The web app is the primary user surface; the CLI exposes ops (serve / sync / list / unpublish / doctor).

## Backend modules

- `src/cxsReader.ts` — read-only adapter over cxs SQLite (sessions, messages, analytics, listProjects).
- `src/projects.ts` — pure `deriveSlugs(cwds)` function: basename slug with sessionCount-weighted parent-basename upgrade on collision.
- `src/sessionIndex.ts` — thin async facade over CxsReader; owns `syncSessions` (delegates to `cxs sync`).
- `src/state.ts` — `StateStore` for `state.json`: publish records, shortcuts, project prefs; all mutations atomic via tmp-rename.
- `src/dashboard.ts` — `http.createServer` + `/api/v1/*` REST surface; serves `web/dist` SPA at `/`.
- `src/api/transcript.ts` — shared `buildTranscriptForShare()` used by the share endpoint.
- `src/parser.ts` / `src/renderer.ts` / `src/redaction.ts` — JSONL → transcript → standalone HTML pipeline, with default redaction.
- `src/publishClient.ts` — thin client for the Cloudflare Worker publish/unpublish API.
- `src/cli.ts` — commander-based CLI (serve, sync, list, unpublish, doctor).
- `src/server.ts` — tiny `listen / close / openBrowser` helpers for the dashboard.

## Frontend modules (`web/src/`)

- `router/` — `/recent`, `/p/:slug`, `/s/:id`, `/search`, `/published`, `/settings` (+ their `/:id` session detail variants).
- `layouts/AppLayout.vue` — 3-column shell: NavSidebar + middle column (SessionList / SearchView / SettingsView depending on route kind) + reading pane.
- `components/NavSidebar.vue` — Shortcuts + Projects + primary nav + Settings / theme footer.
- `components/SessionList.vue` — time-bucketed session list for /recent and /p/:slug.
- `views/SearchView.vue` — chip bar + hit list for /search and /published.
- `views/SettingsView.vue` — Projects alias / hidden + default landing + theme + state dir.
- `views/ReadingPane.vue` / `ReadingEmpty.vue` — session detail or empty state.
- `composables/useProjects.ts` + `useShortcuts.ts` — module-scoped singleton stores.
- `api/client.ts` — typed fetch layer for `/api/v1/*`.

## API surface (`/api/v1/`)

See `prd-v1.md` §7. Summary:

- `GET /projects`, `GET /projects/:slug`, `PATCH /projects/:slug`, `GET /projects/:slug/sessions`
- `GET /sessions?limit&offset&q&project&shared&since&until`, `GET /sessions/:id?messages=1`
- `POST /sessions/:id/share`, `GET /shares`, `DELETE /shares/:localId`
- `GET/POST /shortcuts`, `PATCH/DELETE /shortcuts/:id`

Server binds 127.0.0.1 with no auth (PRD D-08).

## State directory resolution

1. `--state-dir` or `WHAT7_STATE_DIR`
2. `$XDG_STATE_HOME/what7`
3. macOS: `~/Library/Application Support/what7`
4. Otherwise: `~/.local/state/what7`

Layout:

```
<state-dir>/
  state.json        # { records, shortcuts, projects }
  html/             # cached share HTML
```

## Security posture

- Default redaction runs before render/publish (API keys, tokens, env exports).
- `WHAT7_ADMIN_TOKEN` is stored as a Cloudflare secret, never committed.
- Worker stores only a hash of the delete token; the local state holds the capability. Lose the local file → lose the ability to unpublish.
- `/api/v1/shares` and dashboard responses omit delete capability values.
- The public share page is anonymous; debug layers are opt-in via query params (`?tools=1&context=1&debug=1` etc).
