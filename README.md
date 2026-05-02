# what7

`what7` is an agentsview-style local Codex session manager with Cloudflare share publishing. It discovers local Codex JSONL sessions, indexes them for browsing/search/usage summaries, serves a local web dashboard, renders standalone transcript HTML, and publishes/unpublishes public share pages through a Worker backend.

## Install

```bash
npm install
npm run build
npm link   # optional, exposes `what7`
```

Without `npm link`, run the CLI with:

```bash
node dist/cli.js --help
```


## Session management quick start

Index local Codex sessions:

```bash
npm run build
node dist/cli.js sync --json
```

By default this scans `~/.codex/sessions`. Override with either `CODEX_SESSIONS_DIR` or repeated `--dir` flags:

```bash
node dist/cli.js sync --dir ~/.codex/sessions --dir /path/to/fixtures --json
```

Browse indexed sessions in the local dashboard:

```bash
source .what7/deploy.env   # optional, enables dashboard Publish button
node dist/cli.js dashboard --no-open --json
```

The dashboard provides the agentsview-style core loop: session list, message search, analytics cards, transcript viewer, publish, unpublish, and local/remote share links.

CLI session-management commands:

```bash
node dist/cli.js sessions --json
node dist/cli.js session <session-id> --json
node dist/cli.js search "query" --json
node dist/cli.js usage --json
node dist/cli.js stats --json
node dist/cli.js publish-session <session-id> --json
```

`publish-session` accepts an indexed session id such as `codex:<uuid>` or a direct JSONL path. `share-session` is an alias.

## Render local HTML

```bash
npm run build
node dist/cli.js render fixtures/sample.jsonl --json
```

Output defaults to `fixtures/sample.html`. The file is standalone and can be opened directly in a browser. The page includes an agentsview-style sticky header, search, dark/light mode, newest-first toggle, context/thinking toggle, tool-block toggle, collapsible tool cards, and long-output previews.

Useful options:

```bash
node dist/cli.js render fixtures/sample.jsonl -o /tmp/session.html --title "Demo"
node dist/cli.js render fixtures/sample.jsonl --no-redact
```

Redaction is enabled by default. Use `--no-redact` only for trusted local-only output.

## Local preview

```bash
node dist/cli.js preview fixtures/sample.jsonl --no-open --json
```

Remove `--no-open` to open the default browser. The command keeps a local HTTP server running until Ctrl-C.

## Cloudflare Worker setup

The Worker lives in `worker/` and uses KV for share storage.

1. Create a KV namespace:

   ```bash
   npx wrangler kv namespace create WHAT7_SHARES
   ```

2. Replace `replace-with-kv-namespace-id-for-production` in `worker/wrangler.jsonc` with the returned id.
3. Set the publish admin secret. Do not commit this value:

   ```bash
   npx wrangler secret put WHAT7_ADMIN_TOKEN --config worker/wrangler.jsonc
   ```

4. Deploy:

   ```bash
   npx wrangler deploy --config worker/wrangler.jsonc
   ```

For local Worker smoke testing, create an untracked `worker/.dev.vars` file (next to `wrangler.jsonc`) or run with environment variables:

```bash
cat > worker/.dev.vars <<'EOF_DEV'
WHAT7_ADMIN_TOKEN=local-dev-token-change-me
EOF_DEV
npx wrangler dev --config worker/wrangler.jsonc --local --port 8787
```

## Publish / Share

```bash
export WHAT7_WORKER_URL="https://what7-share.<your-subdomain>.workers.dev"
export WHAT7_ADMIN_TOKEN="<secret from wrangler secret put>"
node dist/cli.js publish fixtures/sample.jsonl --json
# alias:
node dist/cli.js share fixtures/sample.jsonl --json
```

The JSON output includes the public share URL and local record id. It does **not** print the delete capability. The delete capability is stored in local state so CLI/dashboard can unpublish later.

## List history

```bash
node dist/cli.js list --json
```

State directory resolution:

1. `--state-dir` or `WHAT7_STATE_DIR`
2. `$XDG_STATE_HOME/what7`
3. macOS: `~/Library/Application Support/what7`
4. Other systems: `~/.local/state/what7`

## Dashboard

```bash
source .what7/deploy.env   # optional; only needed for publish from the dashboard
node dist/cli.js dashboard --no-open --json
```

Open the returned local URL. The dashboard can sync Codex sessions, search/browse indexed sessions, render the selected transcript, show analytics/usage cards, publish the selected session, open remote/local HTML, and unpublish published shares. Delete tokens are not exposed in the dashboard API; the local backend performs unpublish.

## Unpublish

```bash
node dist/cli.js unpublish <local-id-or-url> --json
```

After unpublish, `GET /s/:id` on the Worker returns HTTP 410 with an unpublished page, and the local state record changes to `unpublished`.

## Smoke test against local Worker

Terminal 1:

```bash
cat > worker/.dev.vars <<'EOF_DEV'
WHAT7_ADMIN_TOKEN=local-dev-token-change-me
EOF_DEV
npx wrangler dev --config worker/wrangler.jsonc --local --port 8787
```

Terminal 2:

```bash
npm run build
export WHAT7_WORKER_URL=http://127.0.0.1:8787
export WHAT7_ADMIN_TOKEN=local-dev-token-change-me
export WHAT7_STATE_DIR=$(mktemp -d)
node dist/cli.js publish fixtures/sample.jsonl --json
node dist/cli.js list --json
curl -i "http://127.0.0.1:8787/s/<remote-id>"
node dist/cli.js unpublish <local-id> --json
curl -i "http://127.0.0.1:8787/s/<remote-id>"   # should be 410
```

## Verification

```bash
npm run verify
```

This runs typecheck, unit/integration tests, and build.

## Security notes

- Public share pages are unauthenticated by design. Review rendered HTML before publishing sensitive sessions.
- Default redaction catches common API key/token/env-secret shapes, but it is a safety net, not a proof that every secret is gone.
- Worker publish uses `WHAT7_ADMIN_TOKEN`; store it with `wrangler secret put` or local environment variables, never in source.
- Worker stores only a hash of the delete token. The local state file stores the delete capability and is written with user-only permissions when created.
- `list --json` and dashboard APIs omit delete capability values.

## agentsview reference

This project now implements the Codex-focused local session-management slice of agentsview plus Cloudflare share/unpublish. See `docs/agentsview-reference.md` for the mapping and remaining non-goals.
