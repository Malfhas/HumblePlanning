import { describe, expect, it } from "bun:test";
import { sanitizeSvg } from "./sanitize-html";

describe("sanitizeSvg", () => {
  it("removes scripts, event handlers, javascript: links and external references", () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
      <script>alert(2)</script><script >alert(3)</script >
      <a xlink:href="javascript:alert(4)" href="java&#x09;script:alert(5)"><text>x</text></a>
      <image href="https://tracker.example/p.png"/><rect onclick="alert(6)"/>
      <animate attributeName="href" to="javascript:alert(7)"/><set attributeName="onload" to="alert(8)"/>
      <foreignObject><div>x</div></foreignObject>
      <use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=#x"/></svg>`;
    const clean = sanitizeSvg(evil);
    expect(clean).not.toMatch(/<script|onload|onclick|javascript|foreignObject|tracker\.example|<set|<animate|use href="data/i);
  });

  it("keeps the drawing and internal references, and stays valid XML", () => {
    const legit = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" width="100">
      <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient><circle id="c" r="2"/></defs>
      <rect width="10" height="10" fill="url(#g)"/><use href="#c" x="5"/><use xlink:href="#c"/>
      <image href="data:image/png;base64,AAAA"/><path d="M0 0L1 1"/></svg>`;
    const clean = sanitizeSvg(legit);
    for (const part of ['viewBox="0 0 10 10"', 'fill="url(#g)"', 'href="#c"', 'xlink:href="#c"', 'xmlns:xlink=', 'd="M0 0L1 1"', "data:image/png"]) {
      expect(clean).toContain(part);
    }
  });
});
