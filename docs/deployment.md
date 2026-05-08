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
