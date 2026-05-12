# what7 v1 dogfood issues — 2026-05-08

基于 chrome devtools 真实浏览 + 真实 cxs 数据（~2956 session / 172 project）跑出来的问题清单。按严重度分 P0 / P1 / P2。

**结论**：v1 形态已成，P0/P1 dogfood 问题已清；P2 残余继续按本清单收口。

---

## 总览（status at a glance）

| 编号 | 标题 | 严重度 | 状态 | 承担 intent |
|---|---|---|---|---|
| I-01 | Search 搜不到消息内容 | P0 | ✅ 已修（FTS5 还魂） | int_4d876585 |
| I-02 | ReadingPane 不渲染 markdown | P0 | ✅ 已修（markdown-it + DOMPurify） | int_c7ecb7be |
| I-03 | 点击 session 时 list 闪 Loading | P1 | ✅ 已修（vue-query 接管） | int_bbcfbe59 |
| I-04 | Projects 不折叠 top-N | P1 | ✅ 已修 | int_11c01f18 |
| I-05 | Share / Copy link 按钮没绑 | P1 | ✅ 已修 | int_839101c3 |
| I-06 | 顶部搜索框 disabled + ⌘K 假 | P1 | ✅ 已修 | int_2e120094 |
| I-07 | 噪声 session (ping/no title) | P1 | 🟡 待观察 | — |
| I-08 | cx agent badge 无信息量 | P1 | ✅ 已修 | int_2e120094 |
| I-09 | Meta 字符串含噪声 | P1 | ✅ 已修 | int_2e120094 |
| I-10 | /projects 加载两次 | P2 | ✅ 已修（query key 去重） | int_bbcfbe59 |
| I-11 | Search Project 下拉无筛 | P2 | ✅ 已修（过滤 hidden + sessionCount 排序） | int_1adfba54 |
| I-12 | 键盘快捷键全是假的 | P2 | 🟡 部分（⌘K 已实；↑↓ / S 作为假提示删掉） | int_2e120094 |
| I-13 | Shortcut label 拿不到 session | P2 | ✅ 已修（当前 session 注入 + query cache 兜底） | int_1adfba54 |
| I-14 | Published 详情丢 query | P2 | ✅ 已修（/published/:id + query 保留） | int_1adfba54 |
| I-15 | ReadingPane 无 error boundary | P2 | ✅ 已修（status/request + Retry + 空消息 sourcePath） | int_1adfba54 |

此外，有**两项架构级改造**不以 issue 形式记录（见 `docs/frontend-refactor.md`）：

| 编号 | 标题 | 状态 |
|---|---|---|
| A-01 | 前端引入 @tanstack/vue-query 作 server-state 层 | ✅ 已落地 (int_bbcfbe59) |
| A-02 | `npm run dev` 一键起前后端 (concurrently + tsx watch) | ✅ 已落地 (int_bbcfbe59) |

---

## P0 — 核心功能失灵

### I-01 · Search 搜不到消息内容，只匹配到元数据

**现象**：`/search?q=mainline` 返回 81 条命中，第一条 `看看用户发来的这个需求是要做什么` 属于 `better` 项目，标题里根本没有 `mainline`。

**根因**：
- `src/cxsReader.ts` 的 `list({query})` 里 LIKE 匹配 `session.title / summary_text / compact_text`。
- `summary_text` / `compact_text` 是 cxs 自动生成的元数据，常把项目名塞进去。
- 于是"搜 mainline"变成"搜 session 所属项目名为 mainline 的元数据"，不是搜用户 / assistant 消息内容。

**用户期望**：消息正文中出现 `mainline` 的 session。

**可行修复**：
- cxs 索引本身有 `messages_fts`（FTS5）。之前 `CxsReader.search()` 走的就是这路，M6 cleanup 我错手删了。
- 重写 `CxsReader.searchMessages(q, filters)` 用 `messages_fts MATCH ?`，返回 `{session, snippet, bestHitSeq}`；
- 后端 `/api/v1/sessions?q=` 分派：有 q 走 FTS5，无 q 走 list；
- 前端 SearchView 列表项展示 FTS snippet（`snippet(messages_fts, 0, '«','»','…',12)`）而不是 firstMessage。

**判断标准**：搜 `Prisma` 只返回消息里提过 Prisma 的 session，搜 `mainline` 只返回说过 mainline 的 session（不会因为 session 所在项目叫 mainline 就命中）。

---

### I-02 · Reading pane 不渲染 markdown，长对话无法阅读

**现象**：assistant 消息里 `` `code` `` 显示成字面反引号；`**bold**` 显示字符；2430 字符的一段结论糊脸，无 heading / bullet / code block 折叠。

**根因**：`web/src/views/ReadingPane.vue` 直接 `v-text="m.content"` + `white-space: pre-wrap`。完全没有 markdown 渲染路径。

**对比**：公开 share page（`src/renderer.ts`）反而有 markdown 子集（fenced code / 粗体 / 列表 / 安全转义）。本地阅读比公开阅读还简陋，极为反直觉。

**可行修复**（按投资大小排）：
1. 最小：把 `src/renderer.ts` 里 markdown 子集抽一个纯函数 `renderMarkdownInline(text)` 到 `src/rendererMarkdown.ts`，web 前端同样导出（或复制一份到 `web/src/utils/md.ts`），`v-html="renderMd(m.content)"` + 严格 escape。
2. 引库：`markdown-it` 或 `marked` + 前端 sanitize；包体积 +15-30KB。
3. 升级：上 `shiki` 做代码高亮。（延 v2）

**判断标准**：刚才那条 Fly 事故的 assistant 回复——`**` 粗体 / `-` 列表 / \`prod-maintenance\` 行内 code / `P1008` 错误代码看起来像样。

---

## P1 — 体验痛点

### I-03 · 点击 session 列表项时 Recent/List 列闪 Loading

**现象**：在 `/recent` 点第一条 session（导航到 `/recent/:id`），左侧 SessionList 顶部瞬间出现 "Loading…" 再消失，视觉抖动。

**根因**：`AppLayout.vue` 原先是
```ts
watch(filter, (f) => loadSessions(f), { immediate: true, deep: true });
```
`filter` 是 computed，每次 route 变化都返回**新对象字面量**（即便 `kind`/`slug`/query 都没变），watcher 跟着触发 → `loadSessions` 重跑 → `loading=true`。

**状态**：**已修**（vue-query 接管 server state，从根上避免 watcher 误触发；初版 watcher 修复已被 int_bbcfbe59 的架构替代）。

---

### I-04 · Projects 列表不折叠，172 个项目一列拉到底

**现象**：NavSidebar 里 Projects 区域高度 5409px / 视口 977px，需滚动 6 屏才到 Shortcuts。头部 5-10 个高频项目（每个数百 session）混在同一列表里，和只有 1 session 的长尾项目同权重展示。

**PRD 原设计**（§4.1）：默认 top-12（覆盖 ≈ 80% 文件量），其余折叠 `显示更多 (N)`。

**当前实现**：只有 `hidden` 开关（M4.3）；用户要手动在 Settings 里逐个 hidden——对 160 个长尾项目不现实。

**修复**：NavSidebar 按 `sessionCount DESC` 只渲染前 12（非 hidden），其余塞进 `<details>` `显示更多 (N)`；已钉到 shortcut 的项目不受 top-12 约束。

---

### I-05 · Reading pane 的 Share / Copy link 按钮没绑 handler

**现象**：点 `Share` 按钮无反应；`Copy link` 同样无反应。`ReadingEmpty.vue` 的提示 "`S` share the active session" 也是假的。

**根因**：`ReadingPane.vue` template 有 button 但无 `@click`；`useShortcuts` 里有 `shareSession(id)` API wrapper 但未被调用。

**修复**：
- `Copy link`: `navigator.clipboard.writeText(window.location.href)` + toast。
- `Share`: 调 `shareSession(id)` → 成功 confirm 打开 `publicUrl` + 展示 `Unpublish`；失败（`WHAT7_WORKER_URL` 未设）给明确提示。

---

### I-06 · 顶部搜索框 disabled + `⌘K` 提示假

**现象**：NavSidebar 顶部 `Search sessions` 输入框永远 disabled；右侧 `⌘K` kbd 提示但没绑快捷键。

**修复**：
- 点击输入框 / 按 `⌘K` 直接 `router.push('/search')`；
- 或在当前页就地弹出 cmdk-style 搜索框，输入即跳 `/search?q=`。
- v1 至少让 `⌘K` 先跳路由，v2 再做 modal。

---

### I-07 · 列表里 `(no title)` / `ping` / `ping $1` 这类噪声 session

**现象**：大量只有 1-2 msg 的 ping 测试、空标题 session 占据 Recent 列表位置。

**思路**：
- `(no title)` 可以从 firstMessage fallback（已有）但 `ping` / `ping $1` 本身就是短内容。考虑 `messageCount < 2 && firstMessage.length < 20` 默认折叠在 `Earlier` 底部或 `Show 16 noisy sessions`。
- 或加 user-side "hide short sessions" toggle。
- v1 先不做；只在信息过载特别明显时再加 filter。记录待观察。

---

### I-08 · `cx` agent badge 无信息量

**现象**：列表每行左侧 18×18 `cx` 方块（所有 session 都是 codex），172 次重复。Reading pane 和 SearchView 同样。

**PRD §9 决议**："Reading pane 角色徽章简化为 user / assistant 两色"，但列表行的 agent badge 没在清理范围。

**修复**：删 SessionList 行头的 agent 小方块，节省 26px 宽度给标题。v2 接 claude/cursor 再加回来。

---

### I-09 · Meta 字符串里 session id 短截 / agent 都是噪声

**现象**：ReadingPane header meta 读：`019e0513 · better · codex · 12 msgs · gpt-5.5 · May 8, 2026, 9:05 AM`。`019e0513`（session id 截前 8 位）+ `codex` 都没有阅读价值。

**修复**：
- 删 session id 前缀（想 copy URL 已有 Copy link 按钮）；
- 删 `codex`（唯一 agent 来源）；
- 保留 `better · 12 msgs · gpt-5.5 · May 8, 2026, 9:05 AM` 即可。

---

## P2 — 工程味

### I-10 · `/api/v1/projects` 加载两次

**现象**：首屏 network trace：`/api/v1/projects` 响应 2 次。`NavSidebar.useProjects.refresh()` + `AppLayout.refreshProjects()` 都独立触发。

**修复**：`useProjects` composable 里 refresh 前检查 `loaded.value`，或引入 in-flight promise cache。

**状态**：**已修**（int_bbcfbe59，vue-query 同 query key 自动去重 in-flight 请求）。

---

### I-11 · Search 的 Project 下拉 172 条无筛选

**现象**：SearchView 的 `<select>` 列所有 172 个项目，用户要滚很久。

**修复**：v1 至少在 Settings 给 hidden，跟 NavSidebar 一样过滤 hidden；v2 用 combobox 输入筛。

**状态**：**已修**（int_1adfba54，SearchView 过滤 hidden，并按 `sessionCount DESC` 跟 NavSidebar 对齐）。

---

### I-12 · 键盘快捷键全是假的

**现象**：ReadingEmpty 里列 `↑↓` 导航 / `⌘K` search / `S` share，全部没绑。

**修复**：要么真实现（`/recent` 的 `↑↓` 在 SessionList 里上下移激活项），要么删这段提示避免骗人。v1 倾向删。

---

### I-13 · Shortcut label 推导在 `/recent/:id` 时得不到 session 标题

**现象**：在 `/recent/019e0513...` 点 `+` 钉 shortcut，默认 label 是 "Session"（字面值），而不是 "服务器又挂了…"。

**根因**：`useShortcuts.deriveLabel()` 的 `recent.session` 分支需要 `context.session?.title`，但 NavSidebar 调 `addCurrent(route, { project: currentProject })` 没传 session。

**修复**：NavSidebar inject 当前 reading session（从 ReadingPane 注入 provide/inject，或从 AppLayout 的 sessions[].find(activeId)），传给 addCurrent。

**状态**：**已修**（int_1adfba54，AppLayout provide 当前列表 session，NavSidebar 用 query cache 兜底）。

---

### I-14 · Published / search 详情 session 列链丢 query

**现象**：`/search?q=foo` 点进 `/search/:id?q=foo` ok，但从详情页返回时能保留；`/published/:id` 目前 buildLink fallback 到 `/s/:id`（M4.3 刻意），丢 chip bar 状态。

**修复**：加 `/published/:id` named route，`buildLink` 保留 query。

**状态**：**已修**（int_1adfba54，Published 列表进入 `published.session`，chip query 保留，返回仍回 `/published?...`）。

---

### I-15 · ReadingPane 没有空消息 fallback / error boundary

**现象**：如果 messages 数组为空（比如某 session cxs 没索引全），看到 `No messages.` 一行灰字；如果 fetch 失败，最多显示 `error.message` 一行 monospace。

**修复**：加具名 error 状态（404 / 500 / network），给重试按钮；messages=0 加 hint 指向 sourcePath 方便用户检查。

**状态**：**已修**（int_1adfba54，错误卡片显示 status/request + Retry；空消息显示 `sourcePath`）。

---

## 对我的操作自省

`M6 cleanup` 那把我删 `CxsReader.search()` 是错的。当时只从"M4.2 走 list({query}) 能跑通"静态推断就判死刑，没真实搜过。纯 refactor 不跟真实数据验证 = 偏信调用链静态分析 = 翻车。

教训写进 PRD §Appendix B 作 D-21：**删 API 路径前要带真实 query 跑一次行为测试，确认 UI 流是否真等价**。后续所有清理代码前预设 checklist：
1. 列出 consumer 调用点（静态）；
2. 至少用 1 个真实输入跑通 consumer 完整路径（动态）；
3. 再决定是否删。

---

## 修复优先级

按"让 v1 可用"的最小集合：

1. **I-01 Search FTS5**（P0，半天工作量）
2. **I-02 Markdown 渲染**（P0，1-2 小时）
3. **I-04 Projects top-12 折叠**（P1，1 小时）
4. **I-05 Share/Copy 接通**（P1，1 小时）
5. **I-06 ⌘K 跳 /search**（P1，15 分钟）
6. **I-08 删 cx badge**（P1，10 分钟）
7. **I-09 meta 字符串精简**（P1，10 分钟）

I-07 / I-11–I-14 留 v2 或 Good-first 清单。已修 / 部分已修项不再排队：I-03 / I-10 / I-15（部分）。
