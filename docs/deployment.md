# Deployment state

Current Cloudflare deployment created for this repo:

- Worker name: `what7-share`
- KV namespace title: `what7-shares`
- Public Worker URL: `https://what7-share.copyright.workers.dev`

Secrets are not stored in this repository. The production `WHAT7_ADMIN_TOKEN` is set as a Cloudflare Worker secret and should be kept in a local secret manager or shell environment when publishing.

## Deploy

```bash
npx wrangler kv namespace create WHAT7_SHARES       # once per env; paste id into worker/wrangler.jsonc
npx wrangler secret put WHAT7_ADMIN_TOKEN --config worker/wrangler.jsonc
npx wrangler deploy --config worker/wrangler.jsonc
```

## Local ops

```bash
npm run build
cd web && npm run build
source .what7/deploy.env                            # exports WHAT7_WORKER_URL + WHAT7_ADMIN_TOKEN

what7 serve                                         # primary entry; opens browser
# Share is done from the web UI (session → Share button).

what7 list --json                                   # inspect publish history
what7 unpublish <local-id-or-url> --json            # retract a share
what7 doctor --json                                 # verify cxs db / state dir / worker env / web/dist
```

## Manual share smoke checklist

Run this manually after CI passes, or before trusting a new Worker / env setup. Do not put Worker secrets in CI, commits, screenshots, or issue logs.

Last verified: 2026-05-12 against the live `what7-share.copyright.workers.dev` Worker. The smoke published one real session, confirmed the public share URL returned HTML, confirmed `what7 list --json` did not expose `deleteCapability`, unpublished the share, and confirmed the public URL returned the unpublished page.

### Option A — live Worker env

```bash
source .what7/deploy.env                            # exports WHAT7_WORKER_URL + WHAT7_ADMIN_TOKEN
what7 doctor --json
what7 serve --port 7717 --no-open
```

Then in the web UI:

1. Open `http://127.0.0.1:7717/`.
2. Pick a real session from Recent/Search.
3. Click `Share`; confirm the toast gives/copies a public URL.
4. `curl -fsS "$PUBLIC_URL" | head` and confirm it returns the share HTML.
5. Run `what7 list --json` and confirm the record is present, `status=published`, and no delete capability value is printed.
6. Run `what7 unpublish <local-id-or-url> --json`.
7. `curl -i "$PUBLIC_URL"` and confirm it is no longer the published content (Worker returns the unpublished page/status).

### Option B — local Worker fallback

Use this when live `WHAT7_WORKER_URL` / `WHAT7_ADMIN_TOKEN` are unavailable:

```bash
cat > worker/.dev.vars <<'EOF'
WHAT7_ADMIN_TOKEN=local-dev-token-change-me
EOF

npx wrangler dev --config worker/wrangler.jsonc --local --port 8787

# in another shell:
export WHAT7_WORKER_URL=http://127.0.0.1:8787
export WHAT7_ADMIN_TOKEN=local-dev-token-change-me
what7 doctor --json
what7 serve --port 7717 --no-open
```

Acceptance is the same as live Worker: publish returns a URL, the URL is readable, unpublish retracts it, and `what7 list --json` never exposes the delete capability.

## Worker dev loop

```bash
cat > worker/.dev.vars <<'EOF'
WHAT7_ADMIN_TOKEN=local-dev-token-change-me
EOF

npx wrangler dev --config worker/wrangler.jsonc --local --port 8787

# in another shell:
export WHAT7_WORKER_URL=http://127.0.0.1:8787
export WHAT7_ADMIN_TOKEN=local-dev-token-change-me
what7 serve                                         # web UI → Share will hit the local worker
```
