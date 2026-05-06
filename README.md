# what7

`what7` is a human-friendly local product layer for Codex sessions. It helps you find a recent or relevant local conversation, preview it as a clean transcript, and publish a shareable read-only page through a Cloudflare Worker.

Positioning:

> `cxs` is agent-friendly session retrieval infrastructure. `what7` is the human-friendly find → preview → share product layer. It can reuse the same progressive-retrieval ideas, but it should not become another recall backend.

## Install

```bash
npm install
npm run build
npm link   # optional, exposes `what7`
```

Without `npm link`, run commands with:

```bash
node dist/cli.js --help
```

## Daily workflow: find → preview → share

First index local Codex sessions. By default this scans `~/.codex/sessions`:

```bash
what7 sync
# or without npm link:
node dist/cli.js sync
```

Then use the human-friendly commands from any project directory:

```bash
what7 recent                 # recent sessions, preferring the current cwd project
what7 find "memorable text"   # full-text hits, preferring the current cwd project
what7 view <session-id>      # clean terminal preview
what7 share <session-id>     # render + publish + print URL
what7 share                  # share the most recent current-project session
```

Useful filters:

```bash
what7 recent --all-projects --limit 20
what7 find "deploy failed" --project what7 --since 2026-05-01
what7 view <session-id> --tools --context
what7 share "memorable text" --debug-url
```

All human commands still support stable machine output:

```bash
what7 recent --json
what7 find "query" --json
what7 share <session-id> --json
```

## Local Web workbench

```bash
source .what7/deploy.env   # optional, enables the Share button
what7 serve --no-open --json
```

Open the returned local URL. The workbench is designed for large corpora:

- first load fetches only a bounded recent page (`30` sessions by default);
- `Load more`, search, project filter, and date filters are progressive;
- stats/analytics are **on demand** and do not block first paint;
- selecting a session renders the full transcript only for that one session;
- actions are centered on `Share`, `Copy link`, `Open local`, `Debug view`, and `Unpublish`.

The dashboard never sends the full session corpus to the browser on page load.

## Clean share pages by default

Share pages are for people reading the conversation, not for inspecting internal trace.

Default behavior with no query params:

- tool calls and tool outputs are hidden;
- event, metadata, reasoning, and context blocks are hidden;
- source-path/debug metadata is hidden;
- messages remain readable and searchable.

Debug layers are explicit URL query parameters:

```text
?tools=1              # show tool calls/results
?context=1            # show reasoning/metadata/context
?events=1             # alias for context-style event visibility
?reasoning=1          # alias for context
?debug=1              # show tools + context
```

Typical debug link:

```text
https://<worker>/s/<id>?tools=1&context=1
```

The page also includes local toggles, but the initial state is always clean unless the URL explicitly opts in.

## Explicit file commands remain available

For low-level or scripted workflows, you can still operate on a JSONL path directly:

```bash
what7 render fixtures/sample.jsonl --json
what7 preview fixtures/sample.jsonl --no-open --json
what7 publish fixtures/sample.jsonl --json
```

Compatibility/agent-oriented commands are still present:

```bash
what7 sessions --json
what7 session <session-id> --json
what7 search "query" --json
what7 usage --json
what7 stats --json
what7 publish-session <session-id> --json
```

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

Configure local publishing:

```bash
export WHAT7_WORKER_URL="https://what7-share.<your-subdomain>.workers.dev"
export WHAT7_ADMIN_TOKEN="<secret from wrangler secret put>"
what7 share <session-id>
```

For local Worker smoke testing:

```bash
cat > worker/.dev.vars <<'EOF_DEV'
WHAT7_ADMIN_TOKEN=local-dev-token-change-me
EOF_DEV
npx wrangler dev --config worker/wrangler.jsonc --local --port 8787
```

In another terminal:

```bash
npm run build
export WHAT7_WORKER_URL=http://127.0.0.1:8787
export WHAT7_ADMIN_TOKEN=local-dev-token-change-me
export WHAT7_STATE_DIR=$(mktemp -d)
what7 share fixtures/sample.jsonl --json
what7 list --json
what7 unpublish <local-id> --json
```

## Publish history and unpublish

```bash
what7 list --json
what7 unpublish <local-id-or-url> --json
```

State directory resolution:

1. `--state-dir` or `WHAT7_STATE_DIR`
2. `$XDG_STATE_HOME/what7`
3. macOS: `~/Library/Application Support/what7`
4. Other systems: `~/.local/state/what7`

The JSON output includes public share URLs and local record ids. It does **not** print delete capabilities. Delete capabilities are stored only in local state so CLI/dashboard can unpublish later.

## Security notes

- Public share pages are unauthenticated by design. Review rendered HTML before publishing sensitive sessions.
- Default redaction catches common API key/token/env-secret shapes, but it is a safety net, not a proof that every secret is gone.
- Worker publish uses `WHAT7_ADMIN_TOKEN`; store it with `wrangler secret put` or local environment variables, never in source.
- Worker stores only a hash of the delete token. The local state file stores the delete capability and is written with user-only permissions when created.
- `list --json` and dashboard APIs omit delete capability values.

## cxs boundary

`what7` should not replace `cxs`.

- `cxs`: progressive retrieval, selectors, coverage, ranking, read-range/read-page, and agent recall infrastructure.
- `what7`: human product surface: recent list, current-project preference, search entrypoint, clean preview, share/unpublish, and a local Web workbench.

For v1, `what7` keeps basic sharing independent. Future work can add a narrow adapter that detects a local `cxs` install and uses it for retrieval, while preserving this human-facing CLI/Web surface.

## Verification

```bash
npm run verify
```

This runs typecheck, tests, and build.
