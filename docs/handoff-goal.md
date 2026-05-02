# Handoff Goal: Build `what7` — Codex Session JSONL → HTML Share CLI + Cloudflare Worker Publish

你要把当前空仓库 `/Users/envvar/work/repos/what7` 做成一个可用产品：一个 CLI 工具，方便 human/agent 把 Codex session 对话 JSONL 渲染成可读 HTML，并可选择本地预览或发布到 Web。目标是产品成型，而不是只做 demo。

## Product Outcome

`what7` 应该让用户完成这些核心任务：

1. 从 Codex session JSONL 生成漂亮、可读、可分享的 HTML。
2. 本地运行：生成静态 HTML，并支持本地预览。
3. 发布到 Web：通过 Cloudflare Worker 架构发布公开不可变分享页，返回 URL。
4. 本地状态管理：CLI 记录已发布历史、源 session、标题、URL、发布时间、删除/撤销凭据等。
5. 本地 Web 管理页：用户可以在本机打开一个管理页面，查看历史分享列表，并对已发布内容执行 unpublish。
6. unpublish：本地 CLI / 本地管理页都能撤销已发布分享，使远端 URL 不再可访问或返回明确的 unpublished 状态。

默认产品模型是：

- 公开不可变分享页 MVP。
- 发布后的内容默认不需要登录即可访问。
- 发布操作由本地 CLI 完成。
- 删除/撤销权限保存在本地状态里，不依赖远端账号系统。
- 不做多用户 SaaS、不做复杂账号后台，除非核心 MVP 已经完成。

## Required Research

在实现前，需要参考开源项目中“把 JSONL / chat transcript / agent trace 渲染成 HTML”的实现方式，提炼可复用设计，而不是闭门造车。

至少调研并记录：

- JSONL transcript 如何解析成 message/event timeline。
- assistant / user / tool call / tool result / system metadata 如何分组展示。
- 长日志、代码块、Markdown、错误输出、折叠区如何处理。
- 如何做单文件 HTML 输出或静态资源打包。
- 如何避免把 token、secret、credential、env 泄露到公开分享页。

调研结论要落到 repo 文档里，例如 `docs/research.md` 或设计文档中。实现不需要照抄开源代码，但要能说明借鉴点。

## Functional Requirements

### CLI

提供一个清晰的 CLI，例如 `what7`，至少支持：

- `render <session.jsonl>`：生成本地 HTML。
- `preview <session.jsonl>`：本地渲染并打开/启动预览服务。
- `publish <session.jsonl>`：渲染并发布到 Cloudflare Worker 后端，输出公开 URL。
- `list`：查看本地已发布历史。
- `unpublish <id-or-url>`：撤销远端分享，并更新本地状态。
- `serve` 或 `dashboard`：启动本地 Web 管理页。

CLI 要适合 human 和 agent 使用：

- 有稳定的 JSON 输出模式，例如 `--json`。
- 错误信息明确，非零退出码可靠。
- 支持显式输入/输出路径。
- 不要求用户手动复制隐藏状态文件。
- 不把 secret 打印到 stdout/stderr。

### Renderer

HTML 渲染必须能处理真实 Codex session JSONL，而不是只处理人工 fixture。

最低要求：

- 解析 JSONL 中的会话元数据、用户消息、assistant 消息、tool calls、tool outputs、reasoning/summary 类事件。
- 按时间顺序渲染 conversation timeline。
- 对 tool call / tool output 支持折叠。
- Markdown 和代码块可读。
- 长输出默认折叠或截断，并可展开。
- 页面有标题、时间、来源文件、基本统计信息。
- 单个 HTML 文件可离线打开，或者有明确的 assets 打包策略。
- 默认做基础敏感信息防护：明显 API key/token/env secret 要 redaction；允许用户关闭或配置，但默认安全。

### Cloudflare Worker Publish

采用 Cloudflare Worker 架构。设计要轻量、可部署、可验证。

推荐形态：

- Worker 负责公开读取分享页。
- 存储层可用 KV / R2 / D1 中合适组合；优先简单可靠。
- `publish` 上传渲染后的 HTML 或 normalized artifact。
- 每个分享有不可猜测 ID。
- unpublish 需要本地保存的 delete token / admin token / signed capability。
- 被 unpublish 的页面应返回 404 / 410 / 明确 unpublished 页面。
- 提供 `wrangler` 配置、部署说明和最小 smoke test。

不要把 Cloudflare token、delete token 或用户 session 原文硬编码进 repo。

### Local State

本地状态是产品核心，不是临时缓存。

需要定义稳定状态目录，例如：

- macOS/Linux: XDG state/config 语义，或清楚说明 fallback。
- 保存 publish history：local id、remote id、URL、source path、title、created_at、updated_at、status、delete capability。
- 支持状态迁移或至少版本字段。
- 支持 `list --json` 供 agent 调用。
- unpublish 成功后状态要同步变更。
- 遇到远端已删除、本地状态缺失、重复发布等情况，要有清楚行为。

### Local Web Dashboard

提供本地管理页面，用于：

- 查看发布历史列表。
- 搜索/过滤标题、URL、状态、时间。
- 打开本地 HTML 或远端 URL。
- 一键 unpublish。
- 显示 unpublish 成功/失败状态。
- 不暴露 delete token 到页面源码以外的非必要位置；如果 dashboard 是本地服务，应由本地后端执行敏感操作。

Dashboard 是本地管理面，不是公开 SaaS 后台。

## Non-Goals for MVP

暂不做：

- 多用户账号系统。
- 远端登录后台。
- 评论、协作编辑、访问统计。
- 复杂权限模型。
- 对所有 AI 工具 JSONL 格式的完整兼容。
- 富文本在线编辑器。
- 长期付费/计量系统。

但架构不要把这些未来扩展彻底堵死。

## Quality Bar

这个项目完成时应该像一个可交给别人试用的 CLI，而不是脚本集合。

必须具备：

- README：安装、使用、本地渲染、发布、unpublish、dashboard、Cloudflare 部署。
- 示例 fixture：至少一个脱敏 Codex session JSONL。
- 自动测试：parser、renderer、state store、publish API client、unpublish flow。
- Cloudflare Worker 的本地/远端 smoke test 说明。
- 安全说明：redaction、公开分享风险、delete token 保存位置。
- 清晰的 package scripts / build scripts。
- 可重复的验证命令。

## Success Criteria

当任务完成时，以下验收必须成立：

1. 在干净环境中安装依赖后，`what7 render fixtures/sample.jsonl` 能生成可读 HTML。
2. 生成的 HTML 能直接在浏览器打开，conversation timeline 清楚可读。
3. tool calls / long outputs 默认不会把页面撑爆。
4. `what7 publish fixtures/sample.jsonl --json` 返回稳定 JSON，其中包含 share URL 和 local record id。
5. 访问 share URL 能看到渲染后的公开页面。
6. `what7 list --json` 能看到刚发布的记录。
7. `what7 dashboard` 能打开本地管理页并展示历史记录。
8. 从 CLI 或 dashboard 执行 unpublish 后，远端 URL 不再返回原分享内容。
9. 本地状态记录 unpublish 结果。
10. README 中的命令从零开始可复现。
11. 测试和 lint/typecheck/build 全部通过，或者明确说明无法运行的外部依赖原因。
12. 没有把真实 secret、token、个人 session 内容提交进 repo。

## Implementation Freedom

你可以自行选择技术栈，但要服务于这个产品目标。偏好：

- TypeScript / Node.js 生态优先，因为 CLI、HTML renderer、Cloudflare Worker、Wrangler 可以共享代码。
- 核心 parser/renderer/state/publish client 做成可测试模块，不要全部塞进 CLI 入口。
- Worker 和 CLI 尽量共享 artifact schema。
- 默认走最小可用架构，避免过早 SaaS 化。

如果发现某个技术选择会明显拖慢交付，可以调整，但要在文档里说明取舍。

## Completion Rule

持续推进直到产品满足上述 Success Criteria。不要停在“规划完成”或“核心函数写完”。如果遇到真实阻塞，给出：

- 阻塞点；
- 已验证证据；
- 当前状态；
- 最短解除路径；
- 哪些验收已经通过，哪些还没通过。
