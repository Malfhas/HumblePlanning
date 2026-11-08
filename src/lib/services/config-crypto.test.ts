import { expect, test } from "bun:test";
import { decryptSetting, encryptSetting, encryptedKeyId, isEncryptedValue, loadConfigKeys, parseConfigKey } from "./config-crypto";

const HEX = "a".repeat(64);
const OTHER = "b".repeat(64);
const key = parseConfigKey(HEX);
const other = parseConfigKey(OTHER);
if (!key || key === "invalid" || !other || other === "invalid") throw new Error("test keys");

test("round trip, random IV, value bound to its setting name", () => {
  const a = encryptSetting("SMTP_PASSWORD", "s3cret é", key);
  const b = encryptSetting("SMTP_PASSWORD", "s3cret é", key);
  expect(a).not.toBe(b);
  expect(a).not.toContain("s3cret");
  expect(isEncryptedValue(a)).toBe(true);
  expect(encryptedKeyId(a)).toBe(key.id);
  expect(decryptSetting("SMTP_PASSWORD", a, [key])).toEqual({ ok: true, value: "s3cret é" });
  expect(decryptSetting("MAILGUN_API_KEY", a, [key])).toEqual({ ok: false, reason: "damaged" });
});

test("plain values stay readable; other key, no key and damaged values are told apart", () => {
  expect(decryptSetting("SMTP_PASSWORD", "plain", [])).toEqual({ ok: true, value: "plain" });
  const value = encryptSetting("SMTP_PASSWORD", "x", key);
  expect(decryptSetting("SMTP_PASSWORD", value, [])).toEqual({ ok: false, reason: "no_key" });
  expect(decryptSetting("SMTP_PASSWORD", value, [other])).toEqual({ ok: false, reason: "other_key" });
  expect(decryptSetting("SMTP_PASSWORD", value, [other, key]).ok).toBe(true);
  const tampered = value.slice(0, -2) + (value.endsWith("A") ? "BB" : "AA");
  expect(decryptSetting("SMTP_PASSWORD", tampered, [key])).toEqual({ ok: false, reason: "damaged" });
  expect(decryptSetting("SMTP_PASSWORD", "enc:v1:broken", [key])).toEqual({ ok: false, reason: "damaged" });
});

test("key formats", () => {
  expect(parseConfigKey("")).toBeNull();
  expect(parseConfigKey(undefined)).toBeNull();
  expect(parseConfigKey("generate-with-openssl-rand-hex-32")).toBe("invalid");
  expect(parseConfigKey("too-short")).toBe("invalid");
  expect(parseConfigKey(Buffer.alloc(32, 7).toString("base64"))).not.toBe("invalid");
  expect(parseConfigKey("a passphrase that is long enough to be hashed")).not.toBe("invalid");
  expect((parseConfigKey(HEX) as { id: string }).id).toMatch(/^[0-9a-f]{8}$/);
});

test("status from the environment, previous key readable", () => {
  expect(loadConfigKeys({}).status).toBe("missing");
  expect(loadConfigKeys({ CONFIG_ENCRYPTION_KEY: "short" }).status).toBe("invalid");
  const keys = loadConfigKeys({ CONFIG_ENCRYPTION_KEY: HEX, CONFIG_ENCRYPTION_KEY_PREVIOUS: OTHER });
  expect(keys.status).toBe("active");
  expect(keys.current?.id).toBe(key.id);
  expect(keys.readable.map((k) => k.id)).toEqual([key.id, other.id]);
});
