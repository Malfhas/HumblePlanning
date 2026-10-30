import DOMPurify from "isomorphic-dompurify";

/** Sanitize HTML — strips dangerous tags and attributes while keeping safe formatting. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "b", "i", "em", "strong", "u", "s", "a", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "span", "div", "img"],
    ALLOWED_ATTR: ["href", "title", "target", "rel", "src", "alt", "width", "height", "class", "style"],
    ALLOW_DATA_ATTR: false,
  });
}
