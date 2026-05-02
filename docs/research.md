# Research: JSONL/chat transcript → HTML renderer patterns

本项目实现前参考了几个开源/公开实现，目标不是复制代码，而是抽取可复用产品设计。

## 参考项目

- [`daaain/claude-code-log`](https://github.com/daaain/claude-code-log)：把 Claude Code transcript JSONL 转成 HTML/Markdown。README 明确支持 user/assistant、tool use/results、thinking content、图片、token usage、runtime message filtering、collapsible content 和项目级索引。
- [`simonw/claude-code-transcripts`](https://github.com/simonw/claude-code-transcripts)：把 Claude Code JSON/JSONL 转成 mobile-friendly HTML，输出 `index.html` + 分页页面，也支持把 HTML 发布到 Gist 作为分享页。
- [`getagentseal/codeburn`](https://github.com/getagentseal/codeburn)：不是分享工具，但文档记录了 Codex session 位置和事件形态：`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`，包含 `function_call` 等 tool tracking 事件。
- Cloudflare Workers docs：Workers best practices 强调使用 `wrangler types` 生成绑定类型、secret 不进源码、用 Web Crypto 生成/比较敏感 token；Wrangler 配置文档说明 `compatibility_date`、KV binding 与本地 dev storage 行为。

## 提炼出的实现点

### JSONL timeline

- 不假设每行都是聊天消息；先保留原始 line order，再把 `session_meta`、`turn_context`、`event_msg`、`response_item.payload` 正规化到统一 timeline。
- `response_item.payload.type === "message"` 时按 `role` 展示 user/assistant/system。
- `function_call` / `custom_tool_call` / `tool_call` 统一归为 tool call；`function_call_output` / `tool_result` 统一归为 tool result，用 `call_id` 关联但不依赖关联成功。
- reasoning/summary 类事件单独展示，默认折叠，避免干扰主对话阅读。

### 展示分组

- 主 timeline 按时间/line order 展示，消息卡片区分 role。
- tool call / tool output 默认 `<details>` 折叠，summary 显示工具名、call id、输出长度。
- 长输出不直接撑爆页面：CSS 限制高度，工具输出默认折叠，渲染正文支持代码块。

### 单文件 HTML

- MVP 采用单文件 HTML：CSS/少量 JS 内联，适合离线打开和 Worker 直接存储。
- 不引用 CDN，避免公开分享页在离线或受限网络下缺资源。
- 由于公开分享页可能含敏感数据，Markdown 渲染采用安全子集：先 HTML escape，再处理 fenced code、段落、列表、链接。

### 敏感信息防护

- 默认 redaction 在 HTML 渲染前执行，覆盖常见 `Authorization: Bearer ...`、`*_TOKEN=...`、`api_key=...`、`sk-...`、GitHub token 形态。
- CLI `list --json` 和 dashboard API 默认不输出 delete capability。
- 发布权限用本地 `WHAT7_ADMIN_TOKEN`/CLI 参数传给 Worker；delete capability 只存在本地 state 和 Worker 的 hash 中，Worker KV 不保存明文 delete token。

### 发布/撤销模型

- 类似 Gist 分享工具的“本地生成 artifact → 上传 → 返回 URL”，但目标后端是 Worker + KV。
- 每个 share 使用不可猜测 remote id；unpublish 通过本地保存的 capability 完成，不引入多用户账号系统。
- 被撤销内容返回 410 / unpublished 页面，并删除远端保存的 HTML 正文，避免继续泄露原内容。
