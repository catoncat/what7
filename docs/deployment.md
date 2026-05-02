# Deployment state

Current Cloudflare deployment created for this repo:

- Worker name: `what7-share`
- KV namespace title: `what7-shares`
- Public Worker URL: `https://what7-share.copyright.workers.dev`

Secrets are not stored in this repository. The production `WHAT7_ADMIN_TOKEN` was set as a Cloudflare Worker secret and should be kept in a local secret manager or shell environment when publishing.

Useful commands:

```bash
npm run build
source .what7/deploy.env
node dist/cli.js share fixtures/sample.jsonl --json
node dist/cli.js list --json
node dist/cli.js unpublish <local-id-or-url> --json
```
