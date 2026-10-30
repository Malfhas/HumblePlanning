import { describe, expect, test } from "bun:test";
import { AppError, isMessageKey, statusFromCode } from "./errors";

describe("statusFromCode (last segment of the code)", () => {
  const cases: [string, number][] = [
    ["errors.unauthenticated", 401],
    ["profile.errors.wrongPassword", 401],
    ["errors.invalidApiKey", 401],
    ["errors.forbidden", 403],
    ["tasks.errors.editNotAllowed", 400], // non-normalized suffix → explicit status required
    ["tasks.errors.notAllowed", 403],
    ["tasks.errors.limitReached", 403],
    ["mcp.errors.readOnly", 403],
    ["tasks.errors.notFound", 404],
    ["users.errors.loginAlreadyUsed", 400], // compound camelCase: the whole segment counts
    ["users.errors.alreadyUsed", 409],
    ["tasks.errors.locked", 409],
    ["settings.errors.backupInProgress", 400],
    ["settings.errors.inProgress", 409],
    ["errors.conflict", 409],
    ["errors.invalidData", 422],
    ["errors.rateLimited", 429],
    ["sms.errors.disabled", 503],
    ["errors.internal", 400],
    ["roles.errors.cannotRename", 400],
  ];
  for (const [code, status] of cases) {
    test(`${code} → ${status}`, () => expect(statusFromCode(code)).toBe(status));
  }
});

describe("AppError", () => {
  test("status derived from the code, or explicit", () => {
    expect(new AppError("tasks.errors.notFound").status).toBe(404);
    expect(new AppError("errors.internal", { status: 500 }).status).toBe(500);
  });
  test("carries code, params, fields, details; message = code", () => {
    const e = new AppError("users.errors.invalidFields", {
      status: 409,
      params: { n: 2 },
      fields: { username: { code: "users.errors.loginAlreadyUsed" } },
      details: [1],
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("users.errors.invalidFields");
    expect(e.code).toBe("users.errors.invalidFields");
    expect(e.params).toEqual({ n: 2 });
    expect(e.fields?.username.code).toBe("users.errors.loginAlreadyUsed");
    expect(e.details).toEqual([1]);
  });
});

test("isMessageKey tells codes apart from legacy messages", () => {
  expect(isMessageKey("errors.forbidden")).toBe(true);
  expect(isMessageKey("validation.zod.too_small")).toBe(true);
  expect(isMessageKey("audit.actions.2fa_enable")).toBe(true);
  expect(isMessageKey("Tâche non trouvée")).toBe(false);
  expect(isMessageKey("Impossible de supprimer un compte Super Administrateur.")).toBe(false);
  expect(isMessageKey("forbidden")).toBe(false);
  expect(isMessageKey(42)).toBe(false);
});
