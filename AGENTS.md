<!-- mainline:agents:start version=18 checksum=sha256:1a6f579eddcaf442a55c324dafe49cace9dff335a4494efbc29e2631f4779b72 -->
## Mainline

<!-- mainline-agents-md-version: 18 -->

**Stop AI coding agents from repeating old engineering mistakes.**

This repository uses Mainline, a Git-native memory layer that tells coding agents why the code is the way it is before they edit it. Agents must use the Mainline skill workflow for non-trivial engineering work.
<!-- mainline:agents:end -->

## what7 项目协作约定

### 红线（不可越界）

- **不重做 session 索引**。`~/.local/state/cxs/index.sqlite` 是 cxs 维护的唯一索引来源；what7 只读，不写、不复制、不重新 parse JSONL（README 红线 "not another recall backend"）。
- what7 自己的持久化只放在 `state.json`：发布历史 + Shortcuts + cwd alias。详见 `docs/prd-v1.md` §6。
- 设计 / 实施决策由 `docs/prd-v1.md` 主导；想偏离 PRD 先改 PRD，不要在代码里偷偷改方向。

### 数据画像（M1 起以真实数据为准）

- ~3300 sessions / 6 个月 / 全 Codex；cwd 长尾、top12 占大头。详见 PRD §2。
- Mock 数据集中在 `web/src/data/mock.ts`，M1 接通 API 之后逐项替换，不再新增 mock 假设。
- IA：`Shortcuts + Projects + (Published filter)`，project 内按时间分桶（今天 / 昨天 / 本周 / 更早）。详见 PRD §4。

### 模块边界

- `src/sessionIndex.ts` —— **只读 cxs SQLite reader**（不维护自有索引）。
- `src/dashboard.ts` —— REST API server，对外暴露 `/api/v1/*`（projects / sessions / shortcuts / shares）。监听 127.0.0.1，v1 不做 auth。
- `src/state.ts` —— `state.json` 持久化（publish + shortcuts + alias）。
- `src/renderer.ts` —— share 公开页 + 本地 reading pane 共用渲染器。
- `src/cli.ts` —— 收敛到运维命令（`serve` / `sync` / `unpublish` / `doctor`）；用户面查询统一走 web。详见 PRD §8。
- `web/` —— Vue 3 + vue-router 前端，所有 UI 决策在这里；视觉 token 见 `docs/design-spec.md`。

### 工程节奏

- 每个逻辑独立的改动一个聚焦 commit，conventional 风格（feat/fix/docs/chore/refactor/test）；不混入无关改动。
- Mainline intent 一律用**中文**写 goal / append / seal（按 mainline skill 语言规则；这是丁丁主沟通语言）。
- 验证阶梯：`npm run typecheck` → `npm run test` → 起 dev server `curl` 冒烟。改前端必须本地起 dev server 自查后再交付。
- 给丁丁预览只发**本地 URL**（如 `http://127.0.0.1:5173/...`）；不发截图、不发公网 hostc 隧道，除非他明说要。
- `.commandcode/` 是无关 untracked，永远不动。
