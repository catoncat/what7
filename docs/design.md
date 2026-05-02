# what7 design

`what7` 是一个本地优先 CLI：Codex JSONL 在本机解析、redact、渲染为单文件 HTML；需要分享时再上传到 Cloudflare Worker。

## 组件

- `src/parser.ts`：JSONL → normalized transcript timeline。
- `src/renderer.ts`：transcript → 单文件 HTML，内联 CSS/JS，tool/long output 折叠。
- `src/redaction.ts`：默认敏感信息 redaction。
- `src/state.ts`：XDG/macOS fallback 本地 state，保存 publish history 和 delete capability。
- `src/publishClient.ts`：Worker publish/unpublish API client。
- `src/dashboard.ts`：本地 dashboard HTTP server，前端不接触 delete capability。
- `worker/src/index.ts`：Cloudflare Worker API + public share reader，KV 存储。

## State directory

优先级：

1. `--state-dir` 或 `WHAT7_STATE_DIR`
2. `$XDG_STATE_HOME/what7`
3. macOS: `~/Library/Application Support/what7`
4. 其他系统: `~/.local/state/what7`

State 文件：`state.json`，schema version 当前为 `1`。

## Worker API

- `POST /api/share`：需要 `Authorization: Bearer <WHAT7_ADMIN_TOKEN>`；body 包含 HTML/title/source metadata；返回 `{ id, url, deleteToken }`。
- `GET /s/:id`：公开读取分享页；published 返回 HTML，unpublished 返回 410。
- `POST /api/share/:id/unpublish` 或 `DELETE /api/share/:id`：需要 delete token；成功后远端 HTML 正文清空，状态变为 unpublished。

## Security posture

- 默认 redaction 开启；可用 `--no-redact` 显式关闭。
- 不在 repo、README 或 config 中提交 Cloudflare token/admin token/delete token。
- Worker KV 只保存 delete token hash，不保存明文 capability。
- CLI JSON 输出和 dashboard list API 都隐藏 delete capability。

## Session manager layer

`src/sessionIndex.ts` adds the agentsview-style local index. It discovers Codex JSONL files, normalizes them through the existing parser, stores a user-local `sessions.json` beside publish history, and exposes list/search/analytics helpers for CLI and dashboard. The dashboard APIs render selected sessions on demand with the same standalone share renderer, so local viewing and public publishing stay visually consistent.

### Large-session indexing

Real `~/.codex/sessions` trees can contain thousands of JSONL files and multi-megabyte tool outputs. `sync` therefore parses JSONL with a line stream, stores session summaries in `sessions.json`, and writes bounded searchable previews to `messages.jsonl`. Full transcript rendering still reads the selected source JSONL on demand, so the index stays bounded while the viewer can show the complete session.
