import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { crossOriginRejection, isSameOriginRequest, validateOrigin } from "./csrf";

// Bun loads .env into process.env: each test sets the URL it needs.
let saved: { app?: string; auth?: string };

beforeEach(() => {
  saved = { app: process.env.APP_BASE_URL, auth: process.env.BETTER_AUTH_URL };
  process.env.APP_BASE_URL = "https://planning.example.com";
  delete process.env.BETTER_AUTH_URL;
});

afterEach(() => {
  for (const [key, value] of [["APP_BASE_URL", saved.app], ["BETTER_AUTH_URL", saved.auth]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function post(headers: Record<string, string>, method = "POST") {
  return new Request("https://planning.example.com/api/auth/login", { method, headers });
}

describe("validateOrigin", () => {
  it("accepts a request from the application itself", () => {
    expect(validateOrigin(post({ origin: "https://planning.example.com" }))).toBe(true);
    expect(validateOrigin(post({ referer: "https://planning.example.com/login" }))).toBe(true);
  });

  it("rejects a state-changing request sent by another site", () => {
    expect(validateOrigin(post({ origin: "https://evil.example" }))).toBe(false);
    expect(validateOrigin(post({ origin: "https://planning.example.com.evil.example" }))).toBe(false);
    expect(validateOrigin(post({ referer: "https://evil.example/page" }))).toBe(false);
    expect(validateOrigin(post({ origin: "null" }))).toBe(false);
  });

  it("lets safe methods and calls without Origin or Referer through", () => {
    expect(validateOrigin(post({ origin: "https://evil.example" }, "GET"))).toBe(true);
    expect(validateOrigin(post({}))).toBe(true);
  });
});

describe("crossOriginRejection", () => {
  it("answers 403 to another site and nothing to the application", async () => {
    const rejected = await crossOriginRejection(post({ origin: "https://evil.example" }));
    expect(rejected?.status).toBe(403);
    expect(await crossOriginRejection(post({ origin: "https://planning.example.com" }))).toBeNull();
  });
});

describe("isSameOriginRequest", () => {
  it("accepts a request sent by a page of the application", () => {
    expect(isSameOriginRequest(post({ origin: "https://planning.example.com" }))).toBe(true);
    expect(isSameOriginRequest(post({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("refuses a request without Origin nor Sec-Fetch-Site (native client, script)", () => {
    expect(isSameOriginRequest(post({}))).toBe(false);
    expect(isSameOriginRequest(post({ referer: "https://planning.example.com/profile" }))).toBe(false);
    expect(isSameOriginRequest(post({ "sec-fetch-site": "none" }))).toBe(false);
  });

  it("refuses another site", () => {
    expect(isSameOriginRequest(post({ origin: "https://evil.example" }))).toBe(false);
    expect(isSameOriginRequest(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(post({ origin: "null" }))).toBe(false);
  });

  it("compares with the request's host when no application URL is set", () => {
    delete process.env.APP_BASE_URL;
    expect(isSameOriginRequest(post({ origin: "https://planning.example.com" }))).toBe(true);
    expect(isSameOriginRequest(post({ origin: "https://evil.example" }))).toBe(false);
  });
});
