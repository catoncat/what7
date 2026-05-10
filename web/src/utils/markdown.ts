import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

/**
 * Shared markdown renderer for the reading pane. We lean on markdown-it's
 * default CommonMark + GFM-lite behavior (tables, code fences, linkify) and
 * run every output through DOMPurify so assistant-emitted HTML can't XSS us.
 *
 * Parity note: the public share page (`src/renderer.ts`) hand-rolls a small
 * markdown subset to keep the single-file HTML tiny. The reading pane does
 * not have that constraint, so we use a full markdown library here for a
 * better local reading experience. Share pages stay on the hand-rolled
 * subset for now.
 */

const md = new MarkdownIt({
  html: false,       // do not pass through HTML from source
  linkify: true,     // autolink http[s]://… in plain text
  breaks: true,      // treat single newlines as <br> (chat messages expect it)
  typographer: false,
});

// Force links to open safely in a new tab.
md.renderer.rules.link_open = (tokens, idx, opts, _env, self) => {
  const token = tokens[idx];
  if (token) {
    const targetIdx = token.attrIndex("target");
    if (targetIdx < 0) token.attrPush(["target", "_blank"]);
    const relIdx = token.attrIndex("rel");
    if (relIdx < 0) token.attrPush(["rel", "noopener noreferrer"]);
  }
  return self.renderToken(tokens, idx, opts);
};

export function renderMarkdown(source: string): string {
  if (!source) return "";
  const raw = md.render(source);
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "del", "code", "pre", "kbd", "mark",
      "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "blockquote", "hr",
      "table", "thead", "tbody", "tr", "th", "td",
      "img",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "title"],
    // Don't strip whitespace between blocks — messes with <pre> newlines.
    WHOLE_DOCUMENT: false,
  });
}
