# what7 design spec (2026-05)

施工蓝图，不是 PRD。视觉真相：`/tmp/what7-mocks/v1.png` `v2.png`。

**决议**：workbench 走 v1（Linear 工业冷调），share 走 v2（Substack 暖纸）。两边只通过 brand orange 串线。

## 切片清单

| 切片 | 范围 | 文件 | 验证 |
|---|---|---|---|
| S1 | design tokens 落地 | `src/renderer.ts` `src/dashboard.ts` | tsc --noEmit + 截图 |
| S2 | share 页改 v2 风（hero / byline / blockquote / toolcard） | `src/renderer.ts` (CSS + HTML) | 截图 |
| S3 | workbench 卡片化 + meta 重排 + 状态徽章接 brand orange | `src/dashboard.ts` | 截图 |
| S4 | 移动端断点 + 共用按钮回收 | 两文件 | 双 viewport 截图 |

每片：编辑 → tsc --noEmit → 起 dev server → browser-harness 截图 → 给丁丁拍板 → commit。

## Tokens（S1 落地目标）

```css
/* shared brand —— 仅出现在 CTA / 已分享徽章 / share "open in app" 按钮 */
--brand-orange:       #c9622d;
--brand-orange-soft:  #fdf0e0;
--brand-orange-line:  #f3d8b5;

/* font stacks */
--font-sans-ui:    Inter, "SF Pro Text", -apple-system, system-ui, sans-serif;
--font-serif-read: "Tiempos Text", "Source Serif 4", "Iowan Old Style", Charter, Georgia, serif;
--font-mono:       "JetBrains Mono", "SF Mono", Menlo, monospace;  /* 已存在，重命名对齐 */

/* share-only 暖纸主题（追加到 renderer.ts CSS） */
--share-bg:        #fbf8ee;
--share-surface:   #ffffff;
--share-ink:       #1a1a18;
--share-fg2:       #5b574d;
--share-fg3:       #8e8a7d;
--share-line:      #e8dfc3;
--share-line2:     #d6cdb1;

/* workbench-only 工业冷调（追加到 dashboard.ts CSS） */
--wb-bg:           #08090b;  /* dark 默认 */
--wb-surface:      #141518;
--wb-surface-2:    #1c1d22;
--wb-line:         #23252b;
--wb-fg:           #e7e8ea;
--wb-fg2:          #a4a7ad;
--wb-fg3:          #6c7079;
--wb-accent:       #6e7eff;  /* 选中态、focus ring */
```

现有 `--bg-primary --text-primary --accent-blue` 等 token 保留不动，避免 churn。新 token 加在 `:root` 内同位置，下游样式按需切换。

## 使用规则

- `--brand-orange` 全站只允许 3 处：share `Open in app` 按钮、workbench `Share / Publish` 按钮、`shared` 状态徽章。其它地方出现即 bug。
- workbench 内部的强调（选中行、focus ring、链接）走 `--wb-accent`（蓝紫），不走 brand orange。
- share 文章正文必须用 `--font-serif-read`，UI chrome（topbar / 按钮 / meta 行）必须用 `--font-sans-ui`，代码 / tool name / timestamp 必须用 `--font-mono`。三栈混用是该页风格的本质。
- 颜色硬编码（`#xxxxxx`）只允许出现在 `:root` 块内。其它任何地方出现 hex 都是 lint 失败。

## 验证（每片必跑）

```bash
npx tsc --noEmit                           # 类型不能崩
node --enable-source-maps dist/cli.js render fixtures/sample.jsonl > /tmp/share.html
open /tmp/share.html                       # 视觉抽查
# dashboard:
node dist/cli.js dashboard --port 7717
# 起服务后 browser-harness 截图，给丁丁看
```

## Out of scope（这一轮不动）

- worker (`worker/src/index.ts`) 逻辑不动
- parser / redaction / state / sessionIndex 不动
- 不引入 npm 依赖（CSS only）
- 不动键盘快捷键 / 搜索 / 主题切换功能
