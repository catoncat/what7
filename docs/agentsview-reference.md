# agentsview reference notes

Reference target: [`wesm/agentsview`](https://github.com/wesm/agentsview).

The requested product direction is agentsview-style session management with a first-class share backend. what7 is not a Go/Svelte clone, but it now implements the same core product loop for Codex sessions: discover, sync, browse, search, inspect usage/stats, render/export, publish, and unpublish.

## What agentsview does that matters here

- Local-first session browser: discovers agent sessions, indexes into SQLite, serves a web UI at localhost.
- Session viewer: role-colored message timeline, compact consecutive tool call grouping, thinking/system blocks separated from normal prose, per-message timestamp/model/token metadata.
- Browser UX: keyboard-first navigation, search, filters, newest-first toggle, dark/light mode, and sticky header/context.
- Export/publish: agentsview can export a session to single HTML and publish to GitHub Gist/htmlpreview.
- Privacy posture: no accounts for local browsing, public export/publish is explicit.

## Product translation for what7

`what7` is now a local session manager plus share tool:

- `sync` discovers Codex JSONL sessions under `~/.codex/sessions` or explicit roots.
- A local JSON index stores session metadata, timeline items, search text, token usage, tool counts, and daily/project/agent aggregates.
- `dashboard` is the local browser: sessions, search, analytics cards, transcript iframe, publish, unpublish, and share history.
- `render` / `preview` / `publish` still work on an explicit JSONL file.
- Cloudflare Worker replaces agentsview's Gist/htmlpreview path so unpublish is possible.

## Refactor targets

The share page should feel like a public read-only agentsview session viewer:

- Sticky header with session title, agent/model/source metadata, counts, and publish-safe warning.
- Timeline cards with role color, timestamp, source line, raw event type, and anchors.
- Tool calls/results rendered as compact collapsible tool cards with preview lines.
- Reasoning/thinking/system metadata hidden by default but toggleable.
- Search/filter/newest-first/theme controls embedded in the single HTML file.
- Long outputs default to preview + expandable full content.
- No CDN or backend dependency inside the share page.
- Redaction remains default before render/publish.

## Non-goals

- No SQLite/FTS5 dependency yet; the MVP uses a local JSON index.
- No multi-agent auto-discovery beyond Codex in this iteration.
- No live SSE, resume-in-terminal, stars, pins, trash, PostgreSQL sync, or local delete of source sessions yet.
- No GitHub token/Gist dependency.
