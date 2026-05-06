# what7 v1 PRD — find / preview / share, real data edition

_Author: 丁丁 + Dynamic Pioneer (Claude). 2026-05-06._

这份 PRD 是 `what7` 走出 "mock 设计稿" 阶段、对齐**真实数据**的产品定义。它取代 `docs/handoff-goal.md` 的 IA 与 CLI 假设，并与 `docs/design-spec.md` 共用 brand token，但 IA 在新前端 (`web/`) 上重做，旧 `src/dashboard.ts` 进入 deprecation。

---

## 1. 定位与红线

> `cxs` 是 agent 用的 recall 基础设施。`what7` 是给人用的 **find → preview → share** 产品层。

**红线**（来自 README，PRD 不动）：

- 不做第二个 recall 后端。索引能力**直接复用** cxs 的 SQLite index (`~/.local/state/cxs/index.sqlite`)。
- 公开分享页默认 clean、可读、可分享，不暴露内部 trace。
- 删除 / 撤销凭据存本地，不依赖远端账号。
- 浏览器拿到的不是全语料库，而是分页 / 过滤后的子集。

## 2. 真实数据画像（v1 设计的输入）

- 数据源：`~/.codex/sessions/`，**3303 个 JSONL**，跨度 6 个月。
- 100% Codex 一种 agent，没有 Claude / GPT-5 等其它来源。
- cwd 头部分布陡峭（top1 = 659 files，top5 共 1780 files ≈ 54%），尾部很长（几十个 < 10 files 的小 cwd）。
- 唯一可靠的「项目」维度就是 **cwd path**；没有人类语义命名。

v1 的 IA、命名策略、长尾折叠、第一屏内容都基于这组事实。

## 3. 用户场景（v1 必须支撑）

1. **「刚才那次 deploy 失败的会话」** — 5 分钟内的 active session 回头看。
2. **「上周和 X 聊的思路」** — 找到 → preview → share 出去给人。
3. **「最近一周都在搞啥」** — 周回顾，按 project 看时间分布。
4. **「翻 lzb/better 上次怎么调通的」** — cwd 聚焦 + 全文搜。
5. **「找这条命令」** — 全局搜索 + 命中跳转。

## 4. 信息架构

### 4.1 左 nav 三栏（垂直）

```
┌──────────────────┐
│ ★ Shortcuts      │ ← 用户钉住的 URL，可拖拽排序
│   ‣ ...          │
├──────────────────┤
│ Projects          │ ← cwd 列表，按 file count 降序
│   ‣ better (659) │
│   ‣ browser-…    │
│   ▾ 显示更多 (32)│
├──────────────────┤
│ Settings · ☾◐☀  │ ← theme toggle、状态指示
└──────────────────┘
```

- **Shortcuts** 是 v1 的 "pin" 替代物：钉的是 URL（任意路由 + query），不是 session。详见 §5.3。
- **Projects** 默认显示 top-N（建议 N=12，覆盖 ≈ 80% 文件量），其余折叠在 "显示更多"。每行右侧是 file count 徽章。
- **没有** Inbox / Pinned / Drafts / Agents / Shared 五个 mock 概念。Shared / Published 改为 filter（§4.3）。

### 4.2 主区：Project 视图（默认 = 主入口）

```
[ Project: better ▾ ]   [Today | 7d | 30d | All]   [☐ Shared only]   [🔍 Search]
────────────────────────────────────────────────────────────────────────────────
▸ Today (3)
   · 22:14  调通 worker dev .vars  · 12 turns  · ★ Shared
   · 18:22  npm typecheck 报错排查 · 8 turns
   · 09:30  S2 share 页 hero 改样   · 23 turns
▸ Yesterday (5)
   ...
▸ Earlier this week (12)
   ...
```

- 顶部 chip：时间桶切换 + Shared filter + 搜索。
- 列表按时间分桶（Today / Yesterday / This week / Earlier）。每行：时间、标题（自动从首条 user message 提取）、turn count、shared 徽章（若已发布）。
- 点击行 → reading pane 展开（route 加 `:id`）。
- 没有 "虚拟项目"（all-projects 视图作为特殊 "Project: All"）。

### 4.3 主区：搜索 / 全局视图

- URL：`/search?q=...&since=...&project=...&shared=1`
- 命中按 session 聚合，每条命中显示项目 + 时间 + snippet。
- 「Shared only」是 filter chip，不是顶级 nav。

### 4.4 Reading pane

- 默认渲染 **share-clean** 视图（隐藏 tool calls / reasoning / events）—— 与公开 share 页保持一致。
- 顶部 toggle：`Show debug` 等价于 `?debug=1`。
- 顶部 actions：`Share` / `Copy link` / `Open local` / `Unpublish`（如已发布）。
- 未来 v2 加：turn 级勾选 + 编辑文本再发布（见 §11）。

## 5. URL 路由表

web app 内部路由（vue-router 4 named-views）：

| 路径 | 视图 | 备注 |
|---|---|---|
| `/` | redirect → `/recent` | |
| `/recent` | 全局最近 | 跨 project，时间倒序 |
| `/recent/:id` | 同上 + reading | |
| `/p/:slug` | Project 视图 | slug = basename，重名时见 §6.1 |
| `/p/:slug/:id` | 同上 + reading | |
| `/search` | 全局搜索 | query: `q`, `since`, `project`, `shared` |
| `/search/:id` | 同上 + reading | |
| `/s/:id` | 单 session 直链 | 无 list pane |
| `/published` | 已发布列表 | 等价于 `/recent?shared=1` 的便捷别名 |
| `/settings` | 偏好 / state 管理 | |

shortcut 钉的就是这些 URL（含 query）。

## 6. 数据模型

### 6.1 Project（cwd → slug）

```ts
type Project = {
  cwd: string          // canonical, e.g. "/Users/envvar/lzb/better"
  slug: string         // 唯一短名，URL 安全
  displayName: string  // 默认 = slug；用户可改
  fileCount: number    // 来自 cxs source inventory
  lastActivityAt: string
  hidden?: boolean     // 用户折叠的项目
}
```

**slug 推导（决策 #2 "basename 优先 + 重名升级"）**：

1. 启动时 `cxs status --json` 拿 cwdGroups。
2. 每个 cwd 取 basename 作 slug 候选。同步、零开销。
3. **异步**后台任务：检测 slug 冲突。冲突时给冲突组里**除最大 cwd 外**的项升级为 `parent-basename` (如 `snowy/browser-brain-loop-next`、`work/repos/browser-brain-loop`)。结果写入 `state/projects.json`。
4. 用户可在 Settings 里手改 displayName / hidden。
5. **不**主动读 git remote / package.json（v2 再考虑）。

### 6.2 Session

直接来自 cxs index，不重建。API 层做 shape 适配：

```ts
type Session = {
  id: string
  cwd: string
  startedAt: string
  endedAt: string
  turnCount: number
  title: string         // cxs 已有提取，如缺则取首条 user message 前 60 字
  summary?: string
  shared?: { url: string; localId: string; sharedAt: string }
}
```

### 6.3 Shortcut

```ts
type Shortcut = {
  id: string                // ulid
  label: string
  url: string               // web 内部路由，可含 query
  icon?: string             // emoji or lucide name
  order: number
  createdAt: string
  lastValidatedAt?: string  // lazy 检测
  invalid?: boolean         // 指向的 session/project 已不存在
}
```

- **存储**：`<state-dir>/shortcuts.json`，跟 publish state 同级。
- **失效检测**：每次 web app 启动 / 路由进入 shortcut 时 lazy 检查；标 `invalid: true` 但**不删**，UI 显示为灰色 + tooltip。
- **管理**：sidebar hover 出 `…` 菜单（重命名 / 改 icon / 删除 / 复制 URL）。

### 6.4 Publish state

沿用现有 schema（`local id` ↔ `public URL` ↔ `delete capability` ↔ `sourceSessionId`），新增 `unpublishedAt` 字段。无破坏性迁移。

### 6.5 状态目录布局

```
<state-dir>/        # 默认 ~/Library/Application Support/what7
  state.json        # publish history (现有)
  projects.json     # slug alias / hidden (新)
  shortcuts.json    # (新)
  api-token         # 仅在用户显式 enable API auth 时存在 (v2)
```

## 7. API 设计

**约束**：v1 只监听 `127.0.0.1`，**不做 auth**。前端 fetch 同源。第三方 / cron / MCP 场景 v2 再加 token。

**约定**：JSON in/out，前缀 `/api/v1/`，错误格式 `{error: {code, message}}`。

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/projects` | 列出 projects（带 fileCount, lastActivityAt） |
| GET | `/api/v1/projects/:slug` | 单 project 信息 |
| PATCH | `/api/v1/projects/:slug` | 更新 displayName / hidden |
| GET | `/api/v1/sessions?project=&since=&q=&shared=&cursor=&limit=` | 分页 session 列表 |
| GET | `/api/v1/sessions/:id` | 单 session 元信息 |
| GET | `/api/v1/sessions/:id/transcript?debug=0\|1` | 渲染好的 HTML 片段或结构化 turns |
| POST | `/api/v1/sessions/:id/share` | 发布；返回 `{publicUrl, localId}` |
| DELETE | `/api/v1/shares/:localId` | unpublish |
| GET | `/api/v1/shortcuts` | 列出 |
| POST | `/api/v1/shortcuts` | 创建 |
| PATCH | `/api/v1/shortcuts/:id` | 改 label/icon/order |
| DELETE | `/api/v1/shortcuts/:id` | 删除 |
| GET | `/api/v1/stats` | on-demand 聚合（不在首屏调） |

**数据流**：所有 list/search 类查询 → API 层调用 cxs CLI 或直接读 cxs SQLite → 合并 what7 state.json 里的 share/shortcut 信息 → 返回。**单 session transcript 渲染** 复用现有 `src/renderer.ts` 的 turn 解析，但要从 `dashboard.ts` 解耦出来成 `src/api/transcript.ts`。

## 8. CLI 收敛策略（方案 B：砍用户面，留运维面）

**砍掉**（v1 直接 deprecate，README 标 deprecated 一个版本后移除）：

- `what7 recent` / `find` / `view` / `share <id>` / `share <q>`
- `what7 sessions` / `session` / `search` / `usage` / `stats` / `publish-session`
- `what7 render` / `preview` / `publish` / `dashboard`（dashboard 改名 serve）

**保留**：

- `what7 serve [--port]` — 启 API + web，自动开浏览器。这是用户的唯一入口。
- `what7 sync [--root]` — 全量索引（其实是触发 cxs sync 并刷新 projects.json）。
- `what7 unpublish <id-or-url>` — 撤回公开 URL，命令行兜底，不依赖 web 在跑。
- `what7 list [--json]` — 列出已发布历史，cron / 自动化用。
- `what7 doctor` — 自检 cxs db / worker env / state dir。

所有保留 CLI 仍提供 `--json`。`bin/what7` 二进制保留。

## 9. Mock 假设的处置（清单）

| Mock 概念 | v1 处置 |
|---|---|
| Inbox | 改名 `Recent`（或干脆删，主入口直接是 Project） |
| Pinned | 删除，并入 Shortcuts |
| Drafts | **删除**（数据上不存在） |
| Shared | 改为 filter chip，不是 nav 一级 |
| Projects: what7/agents/cxs/harness | **整表替换**为真实 cwd 列表 |
| Agents: cx/cl/gp 三色徽章 | **删除**，全是 Codex |
| Reading pane 角色徽章 | 简化为 user / assistant 两色 |

## 10. 实现里程碑

按真实可走通路径排序，每个里程碑结束 = 可演示状态。

### M0 — PRD 拍板（本文档）

### M1 — API 层骨架（无 UI 改动）

- 在 `src/` 下新增 `api/` 目录：`api/server.ts`, `api/projects.ts`, `api/sessions.ts`, `api/shortcuts.ts`, `api/shares.ts`。
- `what7 serve` 启动 HTTP server (use Node `node:http` 或保留现有 `server.ts`)。
- 实现 `GET /projects`, `GET /sessions?project=&since=`, `GET /sessions/:id/transcript`。
- **数据源**：cxs CLI 子进程或直读 SQLite。先用子进程兜底（无新依赖），后续可换 better-sqlite3。
- 验证：curl 各 endpoint 拿真数据。

### M2 — Web 重构 IA

- `web/src/` 当前 mock 移除：`Inbox` `Pinned` `Drafts` `Shared` `Agents` 全砍。
- 新建：`PageProject.vue`, `PageRecent.vue`, `PageSearch.vue`, `PagePublished.vue`, `PageSettings.vue`。
- 路由表按 §5 实现。
- Sidebar：Shortcuts 区 + Projects 区（先 mock，M3 接 API）。
- Reading pane 默认 clean，加 `Show debug` toggle。
- 验证：每条路由 200 + 视觉抽查。

### M3 — Web 接 API

- mock 数据替换为 fetch `/api/v1/...`
- Loading / empty / error 状态。
- 全局搜索 + filter chip。
- 验证：3303 个真实 session 走通 list / search / read 三条路径，首屏渲染 < 1s。

### M4 — Shortcuts + Settings

- shortcut CRUD（前端 + 后端）。
- Project alias / hidden 编辑。
- 失效 shortcut 标灰。
- 验证：钉一个 `/p/better?since=7d`，关闭重开仍在并跳转正确。

### M5 — CLI 收敛 + README 重写

- 标 deprecated 旧命令；保留实现 + warning，下个 minor 版本删。
- `what7 doctor` 实现。
- README 重写：装 → `serve` → 完事。运维一节单独。

### M6 — 旧 dashboard.ts deprecate

- 旧路径 `/` redirect 到新 web。
- `src/dashboard.ts` 删除（或保留只兜底）。
- 验证：旧 URL 兼容、新 URL 默认。

## 11. v2+ deferred

- **Turn 级 share 裁剪 + 文本编辑后再发布**（丁丁明确要做）。
- shortcut 同步到云 / 跨设备。
- 多 agent 来源（claude code / cursor / 其它 JSONL 格式）—— 需要 cxs 先支持。
- API token auth + 远程访问。
- MCP server 入口（让 agent 能 query what7）。
- 全文搜结果高亮 + 上下文片段定位。
- 周报 / project 维度的 "刚刚做了啥" 自动总结。
- 移动端 PWA 化（当前响应式只是凑合）。
- 图表 / 用量分析视图。

## 12. Open questions

1. **第一屏默认进哪条路由**？候选：`/recent`（全局）或 `serve` 启动时记录的 launch cwd 对应的 `/p/:slug`。倾向先做 `/recent`，M4 加偏好开关。
2. **Project slug 重名升级触发时机**：启动时全量扫一遍（< 10ms）还是按需 lazy？倾向启动时全量。
3. **Reading pane 是 SSR HTML 片段还是结构化 turns 走前端组件**？前者复用 renderer.ts 最快；后者更可控（turn 级裁剪 v2 必须）。倾向先 SSR、v2 重构。
4. **cxs 子进程 vs 直读 SQLite**：子进程零依赖但慢（每次 ~50ms 启动）；直读快但增加 better-sqlite3 native binding 依赖。倾向 M1 用子进程跑通，性能瓶颈出现后再换。
5. **"Recent" 的去重**：3303 sessions 里有不少几分钟内开关多次的 session。要不要按时间窗 + cwd 合并展示？倾向 v1 不合并，原样列出。
6. **search 结果是 "session 级" 还是 "message 级" 命中**？session 级简单但失精度，message 级要从 cxs 拿 hits 再聚合。倾向 v1 session 级，每条带最佳 snippet。

---

## Appendix A — 与现有文档的关系

| 文档 | 状态 |
|---|---|
| `docs/handoff-goal.md` | **superseded by this PRD**（IA / CLI 部分）。Worker / state schema / 安全部分仍有效。 |
| `docs/design-spec.md` | **共存**。S0 token 系统继续用；S2/S3/S4 切片本来绑定旧 `src/dashboard.ts`，新 `web/` 已经按同样 token 重做（commit `56354e2` `a9d659d` `9b6dc8d` `eae30ad`）。 |
| `docs/research.md` | 仍有效，v1 不动。 |
| `docs/agentsview-reference.md` | 仍有效，作为视觉参考。 |
| `docs/deployment.md` | 仍有效。 |

## Appendix B — 决策日志

| # | 决议 | 输入 |
|---|---|---|
| D-01 | nav 第一层 = Shortcuts + Projects；Project 内时间分桶 | 头脑风暴 #1 |
| D-02 | Project slug = basename 优先，异步检测重名升级 | 头脑风暴 #2 |
| D-03 | Shortcut 替代 Pinned，钉的是 URL 不是 session | 头脑风暴 #3 |
| D-04 | Published 是 filter，不是 nav 一级 | 头脑风暴 #4 |
| D-05 | 砍用户面 CLI（方案 B），保留运维 CLI | 头脑风暴 #5 |
| D-06 | Reading pane 默认 clean，与 share 一致 | 头脑风暴 #6 |
| D-07 | 不重做索引，直接复用 cxs SQLite | README 红线 |
| D-08 | API 层 v1 不做 auth，仅 127.0.0.1 | 第 5 题取舍讨论 |
| D-09 | M1 用 cxs 子进程读数据，性能瓶颈再换 native binding | 第 5 题取舍讨论 |
