import { afterEach, describe, expect, it } from "bun:test";
import { addressBucket, getClientIp } from "./rate-limit";

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

describe("address bucket of the lock keys", () => {
  it("keeps an IPv4 address", () => {
    expect(addressBucket("203.0.113.5")).toBe("203.0.113.5");
    expect(addressBucket(" 203.0.113.5 ")).toBe("203.0.113.5");
  });

  it("counts an IPv6 address by its /64 prefix, whatever its spelling", () => {
    expect(addressBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(addressBucket("2001:0DB8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(addressBucket("[2001:db8:1:2::5]")).toBe("2001:db8:1:2::/64");
    expect(addressBucket("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(addressBucket("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(addressBucket("::1")).toBe("0:0:0:0::/64");
    expect(addressBucket("2001:db8:1:3::1")).not.toBe(addressBucket("2001:db8:1:2::1"));
  });

  it("reads an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(addressBucket("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(addressBucket("::FFFF:cb00:7105")).toBe("203.0.113.5");
    expect(addressBucket("0:0:0:0:0:ffff:203.0.113.5")).toBe("203.0.113.5");
  });

  it("keeps anything that is not an address as it is", () => {
    expect(addressBucket("unknown")).toBe("unknown");
    expect(addressBucket("1:2:3")).toBe("1:2:3");
    expect(addressBucket("1::2::3")).toBe("1::2::3");
    expect(addressBucket("::ffff:300.1.1.1")).toBe("::ffff:300.1.1.1");
    expect(addressBucket("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
  });
});
