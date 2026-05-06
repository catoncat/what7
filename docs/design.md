# what7 design

`what7` 是一个本地优先、人类友好的 Codex session 产品层：Codex JSONL 在本机解析、redact、渲染为单文件 HTML；用户可以从当前目录快速找到最近/相关 session，预览后再上传到 Cloudflare Worker 分享。

它不替代 `cxs`。`cxs` 更适合做 agent-friendly 的 progressive retrieval、selector、coverage、rank、read-range/read-page；`what7` 保持为 human-friendly 的 recent/find/view/share/Web workbench。v1 可以借鉴/适配 `cxs` 能力，但基本分享不强依赖 `cxs`。

## 组件

- `src/parser.ts`：JSONL → normalized transcript timeline。
- `src/renderer.ts`：transcript → 单文件 HTML，内联 CSS/JS，tool/long output 折叠。
- `src/redaction.ts`：默认敏感信息 redaction。
- `src/state.ts`：XDG/macOS fallback 本地 state，保存 publish history 和 delete capability。
- `src/publishClient.ts`：Worker publish/unpublish API client。
- `src/dashboard.ts`：本地 dashboard HTTP server，前端不接触 delete capability。
- `src/humanWorkflow.ts`：human CLI 的 current-project preference、recent/find target resolution、terminal preview formatting。
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

The local Web workbench treats a large corpus as the default:

- `/api/sessions` returns a bounded page (`limit`, `offset`, `has_more`) instead of sending the entire session index to the browser.
- The first page defaults to 30 sessions and clamps oversized limits server-side.
- Search/project/date filters are progressive and use the same bounded page shape.
- `/api/analytics` remains available but is loaded only on demand from the UI.
- `/api/sessions/:id/html` renders the selected source file on demand.

## Human CLI surface

Primary commands are:

- `what7 recent`：show recent sessions, preferring the current cwd project and falling back globally if empty.
- `what7 find <query>`：search indexed messages, preferring current-project hits before broad hits.
- `what7 view <session-or-query>`：terminal preview that hides tools/context unless `--tools` / `--context` is explicit.
- `what7 share [session-or-query]`：resolve omitted args to the recent current-project session, or resolve ids/paths/query text, then render + publish.

Low-level commands (`sessions`, `session`, `search`, `publish`, `publish-session`) remain available for stable agent/JSON workflows.

## Clean transcript default

Rendered HTML is clean by default:

- tool calls/results are hidden unless `?tools=1` or `?debug=1`;
- reasoning/event/metadata/source context is hidden unless `?context=1`, `?events=1`, `?reasoning=1`, or `?debug=1`;
- page toggles can reveal layers after load, but the no-query initial state is human-readable and quiet.
