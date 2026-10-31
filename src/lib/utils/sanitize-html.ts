import DOMPurify from "isomorphic-dompurify";

/** Sanitize HTML — strips dangerous tags and attributes while keeping safe formatting. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "b", "i", "em", "strong", "u", "s", "a", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "span", "div", "img"],
    ALLOWED_ATTR: ["href", "title", "target", "rel", "src", "alt", "width", "height", "class", "style"],
    ALLOW_DATA_ATTR: false,
  });
}

// Attribute values without a URL scheme pass (as with DOMPurify's default);
// the only scheme allowed is an embedded raster image.
const SVG_ALLOWED_URI = /^(?:[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$)|data:image\/(?:png|jpe?g|gif|webp);)/i;

/**
 * Sanitize an uploaded SVG (logos): SVG elements and attributes only; no
 * script, event handler, foreignObject, javascript: or external reference.
 */
export function sanitizeSvg(svg: string): string {
  let clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use"],
    FORBID_TAGS: ["foreignObject"],
    ALLOWED_URI_REGEXP: SVG_ALLOWED_URI,
  });
  // DOMPurify drops namespace declarations: keep the file valid XML when xlink:href is used
  if (/\sxlink:href=/.test(clean) && !/xmlns:xlink=/.test(clean)) {
    clean = clean.replace("<svg", '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  return clean;
}
