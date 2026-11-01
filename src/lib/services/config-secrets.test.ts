import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getEnvManagedKeys, isEnvManaged, isSecretKey } from "./config-secrets";

// Bun loads .env into process.env: each test sets the variables it needs.
const KEYS = ["APP_BASE_URL", "SMTP_PASSWORD", "APP_TITLE"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("keys managed by .env", () => {
  it("lets .env set the public URL written by install.sh, without making it a secret", () => {
    process.env.APP_BASE_URL = "https://planning.example.com";
    expect(isEnvManaged("APP_BASE_URL")).toBe(true);
    expect(getEnvManagedKeys()).toContain("APP_BASE_URL");
    expect(isSecretKey("APP_BASE_URL")).toBe(false);
  });

  it("falls back to the stored setting when .env leaves the URL empty", () => {
    expect(isEnvManaged("APP_BASE_URL")).toBe(false);
    process.env.APP_BASE_URL = "  ";
    expect(isEnvManaged("APP_BASE_URL")).toBe(false);
    expect(getEnvManagedKeys()).not.toContain("APP_BASE_URL");
  });

  it("keeps secrets env-managed and other settings stored in the database", () => {
    process.env.SMTP_PASSWORD = "x";
    process.env.APP_TITLE = "Planning";
    expect(isEnvManaged("SMTP_PASSWORD")).toBe(true);
    expect(isEnvManaged("APP_TITLE")).toBe(false);
    expect(getEnvManagedKeys()).toEqual(["SMTP_PASSWORD"]);
  });
});
