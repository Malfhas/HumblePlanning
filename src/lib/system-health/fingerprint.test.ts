import { describe, expect, it } from "bun:test";
import { eventFingerprint, normalizeMessage, redactQueryParams } from "./fingerprint";

describe("normalizeMessage", () => {
  it("replaces identifiers, e-mails, hashes and numbers", () => {
    expect(normalizeMessage("Task 3f2a1c9e-1b2c-4d5e-8f90-123456789abc not found")).toBe("Task <id> not found");
    expect(normalizeMessage("Bounce for jane.doe@example.com")).toBe("Bounce for <email>");
    expect(normalizeMessage("Push failed (status 503) after 2.5 s")).toBe("Push failed (status <n>) after <n> s");
    expect(normalizeMessage("token deadbeefdeadbeefdeadbeef rejected")).toBe("token <hex> rejected");
  });

  it("collapses whitespace and bounds the length", () => {
    expect(normalizeMessage("  a \n  b\t c ")).toBe("a b c");
    expect(normalizeMessage("x".repeat(2000))).toHaveLength(500);
  });
});

describe("eventFingerprint", () => {
  it("groups the same incident repeated with other values", () => {
    const a = eventFingerprint("ERROR", "api", "Task 3f2a1c9e-1b2c-4d5e-8f90-123456789abc not found (42 ms)");
    const b = eventFingerprint("ERROR", "api", "Task 91bc0000-1b2c-4d5e-8f90-000000000000 not found (7 ms)");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps level, category and message apart", () => {
    const base = eventFingerprint("ERROR", "api", "Unhandled API error: boom");
    expect(eventFingerprint("WARN", "api", "Unhandled API error: boom")).not.toBe(base);
    expect(eventFingerprint("ERROR", "db", "Unhandled API error: boom")).not.toBe(base);
    expect(eventFingerprint("ERROR", "api", "Unhandled API error: bang")).not.toBe(base);
  });
});

describe("redactQueryParams", () => {
  it("removes the bound values of a failed query, keeps the query", () => {
    const message = 'Failed query: insert into "users" ("email", "password") values ($1, $2)\nparams: jane@example.com,$argon2id$v=19$secret';
    expect(redactQueryParams(message)).toBe('Failed query: insert into "users" ("email", "password") values ($1, $2)\nparams: [redacted]');
  });

  it("leaves other texts unchanged", () => {
    expect(redactQueryParams("Push failed (status 503)")).toBe("Push failed (status 503)");
  });
});
