import { afterEach, describe, expect, it } from "bun:test";
import { getClientIp } from "./rate-limit";

const ENV = process.env.TRUSTED_PROXY;
afterEach(() => {
  if (ENV === undefined) delete process.env.TRUSTED_PROXY;
  else process.env.TRUSTED_PROXY = ENV;
});

const headers = (h: Record<string, string>) => new Headers(h);

describe("client IP", () => {
  it("reads X-Real-IP, set by the reverse proxy", () => {
    delete process.env.TRUSTED_PROXY;
    expect(getClientIp(headers({ "x-real-ip": "203.0.113.5" }))).toBe("203.0.113.5");
  });

  it("ignores a forged CF-Connecting-IP without TRUSTED_PROXY=cloudflare", () => {
    delete process.env.TRUSTED_PROXY;
    expect(getClientIp(headers({ "cf-connecting-ip": "1.2.3.4", "x-real-ip": "203.0.113.5" }))).toBe("203.0.113.5");
  });

  it("trusts CF-Connecting-IP behind the Cloudflare proxy", () => {
    process.env.TRUSTED_PROXY = "cloudflare";
    expect(getClientIp(headers({ "cf-connecting-ip": "198.51.100.7", "x-real-ip": "172.70.0.1" }))).toBe("198.51.100.7");
  });

  it("keeps only the X-Forwarded-For entry added by the nearest proxy", () => {
    delete process.env.TRUSTED_PROXY;
    expect(getClientIp(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(getClientIp(headers({}))).toBe("127.0.0.1");
  });
});
