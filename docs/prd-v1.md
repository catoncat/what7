# what7 v1 PRD — find / preview / share, real data edition

_Author: 丁丁 + Dynamic Pioneer (Claude). 2026-05-06（v1 初稿）／ 2026-05-08（M3.5 / M4 扩写）._

这份 PRD 是 `what7` 走出 "mock 设计稿" 阶段、对齐**真实数据**的产品定义。它取代 `docs/handoff-goal.md` 的 IA 与 CLI 假设，并与 `docs/design-spec.md` 共用 brand token，但 IA 在新前端 (`web/`) 上重做，旧 `src/dashboard.ts` 进入 deprecation。

**当前进度**：M0 ✓ · M1 ✓ · M2 ✓（随 M3 一起落）· M3 ✓（search 推迟到 M4.2）· M3.5 待开工 · M4 已定稿待开工。

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

**slug 推导（D-02 "basename 优先 + 重名升级"，M3.5 定稿）**：

1. `CxsReader.listProjects()` 拿到 `cwd[]`（已在 M1 落）。
2. 取每个 cwd 的 basename 作 slug 候选。
3. **同步** 扫一遍冲突（3303 session → 172 cwd，几毫秒）。冲突组里 **sessionCount 最大的一个保留 basename**，其余升级为 `parent-basename`（如 `repos/browser-brain-loop` vs `snowy/browser-brain-loop`）。还冲突再补一层。不走 async 后台任务，启动即定。
4. slug 计算结果缓存在 `state.json.projects` 的 `{slug, cwd, displayName?, hidden?}` 列表里（D-10）。**用户 `displayName` / `hidden` 覆盖自动 slug**：slug 不变，只换呈现。
5. URL 走 slug（非 base64 cwd，M3.5 之前的实现是过渡方案，M3.5 一次性换掉；此前钉的 shortcut 在 M3.5 标 `invalid` 不做迁移，因为此时尚无真实用户数据）。
6. **不**主动读 git remote / package.json（v2 再考虑）。

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
  icon?: string             // emoji，optional
  position: number          // ascending sort, 允许重复（UI 用插入顺序二次稳定）
  createdAt: string
  updatedAt: string
  // 运行时字段（不落盘，M4 先内存态；D-11）：
  invalid?: boolean         // 探活失败（仅内部路由会探）
  lastValidatedAt?: string
}
```

- **存储**：`state.json.shortcuts`（M1 已落，非独立文件；§6.5 同步勘正）。
- **入口**（D-12 单入口）：只在 NavSidebar → Shortcuts 区右上 `+` 按钮能钉；ReadingPane / 其他页面不加。
- **label 推导**（D-13）：首次钉时自动从当前路由推、prompt 预填允许改。推导规则：
  - `/recent` → `"Recent"`；`/recent?since=7d` → `"Recent · 7d"`
  - `/p/:slug` → `project.displayName`；带 `?since=` 追加 `" · 7d"`；带 `?shared=1` 追加 `" · shared"`
  - `/published` → `"Published"`；`/search?q=foo` → `"Search: foo"`（q 截断 24 字）
  - `/s/:id` / 带 `:id` 的详情路由 → 使用 session.title 截断 60 字
- **排序**（D-14 M4 不做 drag）：hover `…` 菜单暴露 `Move up / Move down / Rename / Change icon / Copy URL / Delete`，上下移调用 `PATCH /shortcuts/:id` 改 `position`。批量 drag 排序 M5+ 引库。
- **失效检测**（D-15 lazy + 内存态）：web app 加载时对 shortcut 批量探活（`Promise.allSettled`），仅对内部路由探（`/p/:slug` → `GET /api/v1/projects/:slug`；`/p/:slug/:id`、`/s/:id` → `GET /api/v1/sessions/:id` 404 判 invalid）。外部 https URL 不探。失败标 `invalid: true` + tooltip "Target not found"，不自动删。2 小时窗口内不重复探。`invalid` / `lastValidatedAt` 暂不落盘。
- **空状态**（D-16）：Shortcuts 区为空时显示 hint "Pin views you return to often." + 主按钮 `+ Add current view`。不预置任何默认 shortcut。

### 6.4 Publish state

沿用现有 schema（`local id` ↔ `public URL` ↔ `delete capability` ↔ `sourceSessionId`），新增 `unpublishedAt` 字段。无破坏性迁移。

### 6.5 状态目录布局

```
<state-dir>/        # 默认 ~/Library/Application Support/what7
  state.json        # 全部 what7 本地状态，单文件（D-17 不拆）
                    #   ├ records:    publish history (M0)
                    #   ├ shortcuts:  Shortcut[]      (M1)
                    #   └ projects:   ProjectPref[]   (M3.5 新增)
  html/             # publish 时缓存的 share html
  api-token         # 仅在用户显式 enable API auth 时存在 (v2)
```

`ProjectPref`（§M3.5 引入）：

```ts
type ProjectPref = {
  cwd: string            // 唯一键，与 cxs sessions.cwd 对齐
  slug: string           // 自动算（basename + parent-basename 升级），可被用户覆盖
  displayName?: string   // 用户起的别名；为空时 UI 退回 slug
  hidden?: boolean       // 侧栏隐藏；"显示更多" 只针对非 hidden 项折叠
  updatedAt: string
}
```

---

## 7. API 设计

**约束**：v1 只监听 `127.0.0.1`，**不做 auth**。前端 fetch 同源。第三方 / cron / MCP 场景 v2 再加 token。

**约定**：JSON in/out，前缀 `/api/v1/`，错误格式 `{error: {code, message}}`。

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/projects` | 列 projects，带 displayName（若有）/ hidden / slug |
| GET | `/api/v1/projects/:slug` | 单 project 信息（M3.5 实现） |
| PATCH | `/api/v1/projects/:slug` | 更新 displayName / hidden（M4 实现） |
| GET | `/api/v1/projects/:slug/sessions` | Project 内 session 列表（M1 已落） |
| GET | `/api/v1/sessions?project=&since=&q=&shared=&cursor=&limit=` | 分页 session 列表 |
| GET | `/api/v1/sessions/:id` | 单 session 元信息 |
| GET | `/api/v1/sessions/:id/transcript?debug=0\|1` | 渲染好的 HTML 片段或结构化 turns（M5 抽到 api/transcript.ts） |
| POST | `/api/v1/sessions/:id/share` | 发布；返回 `{publicUrl, localId}` |
| GET | `/api/v1/shares` | 已发布列表（M1 已落） |
| DELETE | `/api/v1/shares/:localId` | unpublish（M1 已落） |
| GET | `/api/v1/shortcuts` | 列 |
| POST | `/api/v1/shortcuts` | 创建 |
| PATCH | `/api/v1/shortcuts/:id` | 改 label/icon/position |
| DELETE | `/api/v1/shortcuts/:id` | 删 |
| GET | `/api/v1/stats` | on-demand 聚合（M5 可选，不在首屏调） |

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

### M3 — Web 接 API ✅

- mock 数据替换为 fetch `/api/v1/...`
- Loading / empty / error 状态。
- 全局搜索 + filter chip（**推迟到 M4.2**：搜索路由和当前 router 命名耦合，放 M3.5 之后统一做）。
- 验证：3303 个真实 session 走通 list / read 两条路径，首屏渲染 < 1s（search 路径在 M4.2 补）。

### M3.5 — Router 命名 + Project slug 定型（新增里程碑）

> 前置原因：M4 要让用户钉 URL，URL 必须先定型，否则 shortcut 钉完 M3.5 一换就全失效。

**M3.5.1 Router 对齐 PRD §5**
- 删 `/inbox` / `/inbox/:id` 命名，按 §5 改 `/recent`、`/recent/:id`、`/p/:slug`、`/p/:slug/:id`、`/s/:id`。
- `/` → redirect `/recent`。
- `/search`、`/published`、`/settings` 先占位（空视图 + `<RouterView>`），路由通，内容留给 M4.2 / M4.3。
- NavSidebar 链接改 `{name: 'recent'}` / `{name: 'project', params: {slug}}`。

**M3.5.2 Project slug = basename（+ 冲突升级）**
- 新增 `src/projects.ts`：`deriveSlugs(cwds: string[]) → Record<cwd, slug>`。纯函数，同步。
- `CxsReader.listProjects()` 返回结构从 `{id: base64url(cwd)}` 改为 `{slug}`，同时保留 `cwd`、`displayName`。
- `/api/v1/projects/:slug/sessions`、`GET /api/v1/projects/:slug` 按 slug 寻址；base64 id 逻辑删干净。
- state.json 引入 `projects: ProjectPref[]`，启动时 merge：slug 以自动算为准，`displayName` / `hidden` 以用户落盘的为准。
- 验证：`curl /api/v1/projects` slug 字段非 base64 且可读；前端 `/p/better` 能展开。

### M4 — Shortcuts + Settings

**M4.1 Shortcuts 前端 UI**
- NavSidebar Shortcuts 区：list + 右上 `+` 按钮（`addCurrentRoute()`，label 按 §6.3 规则自动推 + confirm）。
- 每行 hover `…`：Rename / Change icon / Move up / Move down / Copy URL / Delete。
- 启动时 `Promise.allSettled` 对内部路由探活（见 §6.3）；外部 URL 永远 valid；失败标灰 + tooltip。
- 点击 shortcut → `router.push(shortcut.url)`；如 `invalid` 则先弹一次 confirm。
- 空状态显示 hint + `+ Add current view`。

**M4.2 `/search` + filter chip**
- `/search?q=&since=&project=&shared=` 页：header chip bar（时间桶 + shared-only + project picker），下方 SessionList。
- 底层走 `GET /api/v1/sessions?q=&since=&shared=&project=`，`/api/v1/sessions` 需支持 `shared=1`（过滤 state.json.records 对应 session）和 `project=slug`。
- 命中 session 级，每条带 snippet（来自 `GET /api/v1/sessions/:id/transcript?snippet=q`）。message-level 高亮 v2。

**M4.3 `/settings` Project alias / hidden**
- Settings 主页：
  - **Projects** 表：一行一个 project，列 `displayName`（inline 编辑）/ `slug`（只读）/ `cwd`（只读）/ `hidden`（toggle）。`PATCH /api/v1/projects/:slug`。
  - **Default landing**：单选 `/recent` / "last active project"（默认 `/recent`，呼应 Open Q #1）。
  - **Theme**：mirror 左下 toggle，`localStorage` 单一 source。
  - **State dir**：只读，展示当前 `stateDir`。
- NavSidebar "Projects" 列表响应 hidden（filter 掉），`Show hidden (n)` 折叠入口。

**M4.4 `/published`**
- 直接 `/recent?shared=1` 的便捷路由，sidebar footer 或 Settings 里一个入口。内容等价 M4.2 实现。

**验证**：钉 `/p/better?since=7d` 与 `/search?q=deploy&shared=1`，关闭重开仍在并跳对；Settings 改 `better` 的 displayName 后 NavSidebar 立即反映；hidden 一个 project 后侧栏消失、搜索依旧能跳进去；explicit invalid shortcut（钉一个再删 project）显示灰色。

### M5 — CLI 收敛 + transcript 解耦 + README 重写

- CLI：M1 已收敛到 `serve / sync / unpublish`；M5 补 `doctor` + `list --json`。
- `src/api/transcript.ts`：把 `publishIndexedSession` 里直接读文件 + renderer 的逻辑抽出来，`GET /api/v1/sessions/:id/transcript?debug=0|1` 接上。
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

1. ~~**第一屏默认进哪条路由**~~ → **已决**（M4.3 Settings.Default landing，默认 `/recent`，可选 "last active project"）。
2. ~~**Project slug 重名升级触发时机**~~ → **已决**（M3.5 启动时同步一次，`deriveSlugs` 纯函数）。
3. **Reading pane 是 SSR HTML 片段还是结构化 turns 走前端组件**？当前 M3 走结构化 turns（`GET /api/v1/sessions/:id?messages=1`），由前端渲染。v2 turn 级裁剪以此为基。**维持现状**（改 D-09 方向）。
4. ~~**cxs 子进程 vs 直读 SQLite**~~ → **已决**（M1 直读 better-sqlite3）。
5. **"Recent" 的去重**：3303 sessions 里有不少几分钟内开关多次的 session。要不要按时间窗 + cwd 合并展示？倾向 v1 不合并，原样列出。
6. **search 结果是 "session 级" 还是 "message 级" 命中**？session 级简单但失精度，message 级要从 cxs 拿 hits 再聚合。倾向 v1 session 级，每条带最佳 snippet（M4.2 走 session 级）。
7. **Shortcut drag 排序**：M4 先不做（上下移按钮），M5+ 引 vue-draggable-next。

---

## Appendix A — 与现有文档的关系

| 文档 | 状态 |
|---|---|
| `docs/handoff-goal.md` | **deleted**。v0 立项书，完全被本 PRD 取代；Worker / state schema / 安全部分已迁入 `docs/design.md` + `docs/deployment.md`。 |
| `docs/agentsview-reference.md` | **deleted**。灵感参考，相关决策已落在本 PRD + 当前代码里。 |
| `docs/design.md` | **重写**（M6 cleanup）：实现模块地图，反映当前 M1-M6 架构。 |
| `docs/design-spec.md` | **更新**（M6 cleanup）：token 分布、字体与 brand-orange 规则；CSS 位置从旧 `src/dashboard.ts` 改为 `web/src/assets/main.css` + `src/renderer.ts`。 |
| `docs/research.md` | 仍有效，v1 不动。 |
| `docs/deployment.md` | **更新**（M6 cleanup）：CLI 命令对齐保留命令集。 |

## Appendix B — 决策日志

| # | 决议 | 输入 |
|---|---|---|
| D-01 | nav 第一层 = Shortcuts + Projects；Project 内时间分桶 | 头脑风暴 #1 |
| D-02 | Project slug = basename 优先，同步检测重名升级（M3.5 定稿为**同步**） | 头脑风暴 #2 |
| D-03 | Shortcut 替代 Pinned，钉的是 URL 不是 session | 头脑风暴 #3 |
| D-04 | Published 是 filter，不是 nav 一级 | 头脑风暴 #4 |
| D-05 | 砍用户面 CLI（方案 B），保留运维 CLI | 头脑风暴 #5 |
| D-06 | Reading pane 默认 clean，与 share 一致 | 头脑风暴 #6 |
| D-07 | 不重做索引，直接复用 cxs SQLite | README 红线 |
| D-08 | API 层 v1 不做 auth，仅 127.0.0.1 | 第 5 题取舍讨论 |
| D-09 | ~~M1 用 cxs 子进程~~ → M1 实际走 better-sqlite3 直读（实现偏离，已更正） | M1 落地 |
| D-10 | 状态合一到 state.json（records + shortcuts + projects），不拆 projects.json / shortcuts.json | M3.5 扩写 |
| D-11 | Shortcut.invalid 只内存态，不落盘（M4） | M4 扩写 |
| D-12 | Shortcut 钉入口单一，仅 NavSidebar `+` 按钮 | M4 扩写 |
| D-13 | Shortcut label 首次自动推 + prompt 可改；无静默命名 | M4 扩写 |
| D-14 | M4 不做 drag 排序，菜单内 Move up / Move down；drag 延到 M5+ | M4 扩写 |
| D-15 | Shortcut 失效检测：启动时 lazy，只探内部路由，2h 窗内缓存 | M4 扩写 |
| D-16 | Shortcuts 区空状态 hint + 主 Add 按钮；不预置默认 shortcut | M4 扩写 |
| D-17 | state.json 单文件，`{records, shortcuts, projects}` 并列 | M3.5 扩写 |
| D-18 | 第一屏默认 `/recent`，Settings 可切 "last active project" | Open Q#1 / M4.3 |
| D-19 | search 先做 session 级命中（v1），message 级 v2 再说 | Open Q#6 / M4.2 |
| D-20 | Reading pane = 结构化 turns 前端渲染（M3 已落），**推翻 Open Q#3 原倾向 SSR** | M3 落地 |
