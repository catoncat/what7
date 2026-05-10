# Frontend refactor — 讨论稿

针对 v1 dogfood 暴露的结构性问题（见 `docs/issues-v1-dogfood.md`）的前端侧改造讨论。

本文档是**讨论稿**，不是实施计划。每个条目拍板之后再写 intent。

---

## 话题 1：Query client / server-state 管理

### 起因

当前前端手写 fetch + module-scoped `ref`（`useProjects`、`useShortcuts`）。暴露了几个结构性问题：

- **I-03** AppLayout 的 `filter` computed 每次 route 变化返回新对象，watcher 误触发，列表闪 Loading。手动修了但是 patch 思路，不是根治。
- **I-10** NavSidebar + AppLayout 都调 `/api/v1/projects`，同页两次请求。
- **I-05** Share/Copy 按钮没绑，ad-hoc mutation 代码写起来麻烦。
- 没有 staleTime 概念 → 来回切 `/recent` ↔ `/p/better` 每次都重新 fetch，即便数据没过期。
- 没有统一 invalidation → 改了 project displayName 后 NavSidebar 要手动 patch，容易漏。

核心结论：**server state 需要一个 query client 托管**，手写 ref 到 20+ 端点时注定崩。

### 候选库

| 库 | Bundle (gzip) | 成熟度 | Vue 原生 | 备注 |
|---|---|---|---|---|
| `@tanstack/vue-query` | ~13 KB | 主流，TanStack 官方 Vue 端口 | 是 | 全家桶 + devtools |
| `@pinia/colada` | ~6 KB | 新，Pinia 团队 | 最原生 | 语义近似 vue-query 但更 Vue-idiom；文档较浅 |
| `swrv` | ~3 KB | 不活跃 | 是 | 只有 SWR，没 mutations 原语 — 排除 |
| Pinia + 自造 | ~2 KB | 最稳 | 是 | 等于重写 query cache — 排除 |

### 拍板

**选 `@tanstack/vue-query`**。

理由：
- 直接修掉 I-03 / I-10 / I-05 三件事。
- Devtools 对调试 cache/invalidation 作用巨大。
- 心智模型和 React Query 一致，跨项目复用经验。
- 13 KB bundle 代价可接受（116 KB → ~129 KB）。

不选 Colada：更轻、更 Vue，但文档深度和社区规模差一截，v1 要的是稳。

### 实施边界

**改**：
- 新增 `web/src/queries.ts` 收纳 query key factories + `queryOptions`（`projectsQuery()`、`sessionsQuery(params)`、`sessionDetailQuery(id)`、`shortcutsQuery()`）。
- `useProjects` / `useShortcuts` 从手写 ref 改成 `useQuery + useMutation` 薄包装。
- `AppLayout.vue` `loadSessions` watcher 整块删，换响应式 `useQuery`。
- `main.ts` 注册 `VueQueryPlugin` + QueryClient 默认配置。

**不改**：
- `api/client.ts` 签名（保持纯 `Promise<T>`，vue-query 的 queryFn 直接调它）。
- 后端 REST。
- `state.json` 落盘逻辑。
- Shortcut 探活机制（纯内存，不走 query cache；可以 pruning 代码但范围独立）。

### 建议默认值

- 全局：`staleTime: 30_000`、`refetchOnWindowFocus: true`、`retry: 1`。
- `['projects']`：staleTime 5 min。
- `['sessions', params]`：staleTime 30 s。
- `['session', id]`：staleTime Infinity（单 session immutable）。
- `['shortcuts']`：staleTime 0（action-driven）。
- Mutations：只有 shortcut reorder（moveUp/moveDown）做 optimistic；其余走标准 pending → success → invalidate 流。Share / updateProject 失败要回滚 state.json，保守不做 optimistic。

### 待确认（问丁丁）

- [x] 确认选 vue-query 而非 Colada → **选 vue-query**
- [x] `refetchOnWindowFocus` → **开**
- [x] v1 暂不引入 Pinia → **不引入**
- [x] Optimistic update 只在 shortcut reorder 做 → **是**

丁丁 2026-05-08 拍板 "按推荐"。

---

## 话题 2：(待补充)

---

## 话题 3：(待补充)

---

## 附：相关 dogfood issue 定位

| Issue | 与前端架构关系 |
|---|---|
| I-02 Markdown 渲染 | 独立，不在本文档范围 |
| I-03 Loading 闪烁 | Query client 修根（本文档话题 1） |
| I-05 Share/Copy 按钮 | Mutation 用 useMutation 实现（话题 1） |
| I-10 `/projects` 双请求 | Query key 去重（话题 1） |
| I-13 deriveLabel 拿不到 session | 需要当前 session 的注入机制，可能走 provide/inject 或 pinia；后续讨论 |
| I-15 ReadingPane error boundary | 有了 useQuery 的 `isError` 更容易做；话题 1 顺带受益 |
