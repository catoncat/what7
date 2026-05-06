import type { AgentDef, MessageBlock, Project, Session, SessionDetail } from "../types";

export const projects: Project[] = [
  { slug: "what7", name: "what7", color: "#6e7eff" },
  { slug: "agents", name: "agents", color: "#7fbf6e" },
  { slug: "cxs", name: "cxs", color: "#d6a45a" },
  { slug: "harness", name: "browser-harness", color: "#c186e0" },
];

export const agents: AgentDef[] = [
  { slug: "cx", name: "codex", glyph: "cx", fg: "#d8b8ff", bg: "#3a2a4a" },
  { slug: "cl", name: "claude", glyph: "cl", fg: "#bfe8b6", bg: "#2c3a2a" },
  { slug: "gp", name: "gpt-5", glyph: "gp", fg: "#bcd1ff", bg: "#2a3247" },
];

const now = Date.now();
const minutes = (n: number) => new Date(now - n * 60_000).toISOString();
const hours = (n: number) => new Date(now - n * 3_600_000).toISOString();
const days = (n: number) => new Date(now - n * 86_400_000).toISOString();

export const sessions: Session[] = [
  { id: "s-001", title: "what7 redesign \u2014 vp + Vue \u8def\u7531\u65b9\u6848", agent: "cx", project: "what7", messageCount: 38, toolCount: 14, startedAt: minutes(8), pinned: true, preview: "\u7ee7\u7eed\u63a8\u8fdb v1 IA \u62c6\u6210\u5d4c\u5957\u8def\u7531..." },
  { id: "s-002", title: "Linear \u00d7 ChatGPT share \u2014 \u4e09\u680f\u5e03\u5c40\u8c03\u6574", agent: "cl", project: "what7", messageCount: 22, toolCount: 6, startedAt: minutes(45), draft: true, preview: "\u4e2d\u95f4\u5217\u8868 360px \u592a\u6324\uff0c\u6539\u6210 380..." },
  { id: "s-003", title: "agentsview \u91cd\u6784\uff1astreaming JSONL \u89e3\u6790", agent: "cx", project: "agents", messageCount: 64, toolCount: 31, startedAt: hours(2), shared: true, preview: "\u7528 line stream \u66ff\u4ee3 readFile..." },
  { id: "s-004", title: "browser-harness daemon CDP \u63e1\u624b\u5931\u8d25\u6392\u9519", agent: "gp", project: "harness", messageCount: 19, toolCount: 8, startedAt: hours(4), preview: "python-socks missing \u2014 pip install" },
  { id: "s-005", title: "cxs read-page \u6027\u80fd profiling", agent: "cl", project: "cxs", messageCount: 41, toolCount: 22, startedAt: days(1), pinned: true, preview: "rg + xargs \u6bd4 grep \u5feb 4\u00d7..." },
  { id: "s-006", title: "what7 worker KV \u7d22\u5f15\u91cd\u5efa", agent: "cx", project: "what7", messageCount: 27, toolCount: 11, startedAt: days(1), shared: true, preview: "wrangler kv:bulk put \u5931\u8d25..." },
  { id: "s-007", title: "redaction policy \u2014 \u52a0\u5bc6\u94a5/token \u6a21\u5f0f", agent: "gp", project: "what7", messageCount: 15, toolCount: 4, startedAt: days(1), preview: "regex \u5e93\u8986\u76d6 OpenAI / GitHub / AWS..." },
  { id: "s-008", title: "agents skill registry \u7d22\u5f15\u683c\u5f0f v3", agent: "cl", project: "agents", messageCount: 33, toolCount: 9, startedAt: days(3), draft: true, preview: "preferred_path \u5b57\u6bb5..." },
  { id: "s-009", title: "cxs progressive retrieval selectors", agent: "cx", project: "cxs", messageCount: 52, toolCount: 18, startedAt: days(4), pinned: true, preview: "selector chain \u652f\u6301 OR..." },
  { id: "s-010", title: "browser-harness new_tab vs goto", agent: "gp", project: "harness", messageCount: 12, toolCount: 5, startedAt: days(5), preview: "goto \u4f1a\u8986\u76d6\u7528\u6237\u5f53\u524d tab..." },
  { id: "s-011", title: "agentsview reference markdown ports", agent: "cl", project: "agents", messageCount: 21, toolCount: 7, startedAt: days(12), preview: "renderer.ts CSS \u63d0\u5230 v2..." },
  { id: "s-012", title: "what7 publish flow \u2014 admin token rotation", agent: "cx", project: "what7", messageCount: 29, toolCount: 13, startedAt: days(20), preview: "wrangler secret put..." },
];

function transcript(key: string): MessageBlock[] {
  return [
    { id: `${key}-m1`, role: "user", content: "\u6211\u4eec\u7684\u4ea7\u54c1\u662f ai \u751f\u6210\u7684 UI\uff0c\u6ca1\u8bbe\u8ba1\u8fc7\u3002\u4f60\u4f5c\u4e3a\u4ea7\u54c1\u7ecf\u7406\u548c\u8bbe\u8ba1\u5e08\uff0c\u5148\u7406\u89e3\u8fd9\u4e2a\u9879\u76ee\u662f\u505a\u4ec0\u4e48\u7684\u3002" },
    { id: `${key}-m2`, role: "reasoning", content: "\u7528\u6237\u5e0c\u671b\u4ece\u4ea7\u54c1\u4ea4\u4e92\u91cd\u6784\uff0c\u4e0d\u662f\u5207\u6837\u5f0f\u3002\u5148 git_status\uff0c\u518d\u5217\u7ade\u54c1\u3002", collapsed: true },
    { id: `${key}-m3`, role: "assistant", content: "\u660e\u767d\u3002what7 \u662f\u672c\u5730 Codex session \u7ba1\u7406\u5668\uff1a\u5de6\u4fa7\u7d22\u5f15\u3001\u4e2d\u95f4\u5217\u8868\u3001\u53f3\u4fa7 reading pane\u3002\u5efa\u8bae\u53c2\u8003 Linear\uff08\u5de6 nav + \u4e2d list + \u53f3 detail\uff09\u548c ChatGPT share\uff08reading pane \u957f\u6587\u9605\u8bfb\uff09\u3002" },
    { id: `${key}-m4`, role: "tool", meta: "git_status", content: "On branch main\nChanges not staged for commit:\n  modified:   src/dashboard.ts\n  modified:   src/renderer.ts\nUntracked: web/" },
    { id: `${key}-m5`, role: "user", content: "\u597d\uff0c\u5148\u51fa prd \u8fd8\u662f\u5148\u505a\u4ec0\u4e48\uff1f" },
    { id: `${key}-m6`, role: "assistant", content: "\u5148\u51fa mock \u8bbe\u8ba1\u7a3f\uff08v1 \u5de5\u4e1a\u51b7\u8c03 + v2 \u6696\u7eb8 reader\uff09\u8ba9\u4f60\u62cd\u677f\u3002\u62cd\u677f\u540e\u518d\u51fa PRD + \u5207\u7247\u5b9e\u73b0\u3002" },
    { id: `${key}-m7`, role: "tool", meta: "write_file", content: "/tmp/what7-mocks/v1.html (23387 B)\n/tmp/what7-mocks/v2.html (21935 B)" },
  ];
}

export function detail(id: string): SessionDetail | undefined {
  const session = sessions.find((s) => s.id === id);
  if (!session) return undefined;
  return { ...session, messages: transcript(id) };
}
