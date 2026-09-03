// Markdown rendering for bot replies. Bot output is untrusted
// (it may quote web content) → always run it through DOMPurify.
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

// Links in bot replies open in a new tab without opener access
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(String(text ?? "")), { USE_PROFILES: { html: true } });
}
