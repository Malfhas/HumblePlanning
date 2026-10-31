import { describe, expect, test } from "bun:test";
import { contentDisposition } from "./file-response";

describe("contentDisposition", () => {
  test("previewed types stay inline", () => {
    expect(contentDisposition("image/webp", "photo.webp")).toStartWith("inline;");
    expect(contentDisposition("image/jpeg", "photo.jpg")).toStartWith("inline;");
    expect(contentDisposition("application/pdf", "plan.pdf")).toStartWith("inline;");
  });

  test("anything else is downloaded", () => {
    expect(contentDisposition("application/octet-stream", "page.html")).toStartWith("attachment;");
    expect(contentDisposition("image/svg+xml", "logo.svg")).toStartWith("attachment;");
    expect(contentDisposition("application/msword", "doc.doc")).toStartWith("attachment;");
    expect(contentDisposition("image/x-icon", "favicon.ico")).toStartWith("attachment;");
  });

  test("encodes the file name without header injection", () => {
    const header = contentDisposition("application/pdf", "Devis \"final\"\r\nX-Evil: 1 é(1)'.pdf");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header).toContain(`filename="Devis _final___X-Evil: 1 _(1)'.pdf"`);
    expect(header).toContain("filename*=UTF-8''Devis%20%22final%22%0D%0AX-Evil%3A%201%20%C3%A9%281%29%27.pdf");
  });
});
