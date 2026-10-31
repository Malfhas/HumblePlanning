/**
 * Response headers of uploaded files served by the application.
 */

/** Types the UI previews inside the page (`<img>`, PDF `<iframe>`): served inline. */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
]);

/** RFC 5987 value: `encodeURIComponent` plus the characters it leaves alone but `attr-char` forbids. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `Content-Disposition` of an uploaded file. Only the types the UI previews
 * are inline; anything else (HTML, SVG, XML, office documents…) is downloaded,
 * so a file a browser could render as a document never runs in the
 * application's origin.
 */
export function contentDisposition(contentType: string, fileName: string): string {
  const disposition = INLINE_TYPES.has(contentType) ? "inline" : "attachment";
  // ASCII fallback for old clients: no control characters, quotes or backslashes.
  const asciiName = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}
