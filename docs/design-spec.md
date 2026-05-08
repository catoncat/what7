# what7 design spec (2026-05)

视觉真相：workbench 走 Linear 工业冷调（`web/src/assets/main.css`），share 走 Substack 暖纸（`src/renderer.ts` 内联 CSS）。两边通过 brand orange 串线。设计 tokens 分布：

- workbench 冷调 + brand accent：`web/src/assets/main.css`（Vue SPA 消费）。
- share 暖纸：`src/renderer.ts` 渲染的单文件 HTML 内联 CSS。

## Tokens 约定

```css
/* shared brand —— 仅出现在 CTA / 已分享徽章 / share "open in app" 按钮 */
--brand-orange:       #c9622d;
--brand-orange-soft:  #fdf0e0;
--brand-orange-line:  #f3d8b5;

/* font stacks */
--font-sans-ui:    Inter, "SF Pro Text", -apple-system, system-ui, sans-serif;
--font-serif-read: "Tiempos Text", "Source Serif 4", "Iowan Old Style", Charter, Georgia, serif;
--font-mono:       "JetBrains Mono", "SF Mono", Menlo, monospace;

/* share-only 暖纸（renderer 内联 CSS） */
--share-bg:        #fbf8ee;
--share-surface:   #ffffff;
--share-ink:       #1a1a18;
--share-fg2:       #5b574d;
--share-fg3:       #8e8a7d;
--share-line:      #e8dfc3;
--share-line2:     #d6cdb1;

/* workbench 冷调（web/src/assets/main.css） */
--bg:              #08090b;
--surface:         #141518;
--surface-2:       #1c1d22;
--line:            #23252b;
--fg:              #e7e8ea;
--fg-2:            #a4a7ad;
--fg-3:            #6c7079;
--accent:          #6e7eff;
```

## 使用规则

- `--brand-orange` 全站只允许 3 处：share `Open in app` 按钮、workbench `Share / Publish` 按钮、`shared` 状态徽章。其它地方出现即 bug。
- workbench 内部的强调（选中行、focus ring、链接）走 `--accent`（蓝紫），不走 brand orange。
- share 文章正文用 `--font-serif-read`，UI chrome 用 `--font-sans-ui`，代码 / tool name / timestamp 用 `--font-mono`。三栈混用是该页风格的本质。
- 颜色硬编码（`#xxxxxx`）只允许出现在 `:root` 块内。其它任何地方出现 hex 都是 lint 失败。

## 验证

```bash
# backend + worker
npm run verify

# web
cd web && npm run build

# share 页视觉：跑一次 publish，或跑 fixtures 测试里的 snapshot
npm test -- parser-renderer

# workbench 视觉：起 serve，浏览器走一遍 /recent /p/:slug /search /settings
what7 serve
```

## Out of scope

- Worker (`worker/src/index.ts`) 逻辑只受影响于 share HTML 传输层，不参与 design token。
- parser / redaction / state / projects 逻辑对 design 不可见。
- CSS only，不引入 UI 库或新 npm 依赖。
