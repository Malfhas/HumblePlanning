import { describe, expect, it } from "bun:test";
import { createUserSchema, updateUserSchema } from "./user";

const ROLE_ID = "00000000-0000-0000-0000-000000000004";

describe("user validators", () => {
  it("createUserSchema applies the creation defaults", () => {
    const data = createUserSchema.parse({ name: "Doe", username: "jdoe", roleId: ROLE_ID });
    expect(data).toMatchObject({
      color: "#FFFFFF",
      visibleOnPlanning: true,
      notifications: false,
      pushNotifications: false,
      smsNotifications: false,
      active: true,
    });
  });

  it("updateUserSchema adds no field the request did not send", () => {
    expect(updateUserSchema.parse({})).toEqual({});
    expect(updateUserSchema.parse({ phone: "0102030405" })).toEqual({ phone: "0102030405" });
  });

  it("updateUserSchema keeps the explicit values", () => {
    expect(updateUserSchema.parse({ active: false, forceTwoFactor: true, forcePasswordChange: false })).toEqual({
      active: false,
      forceTwoFactor: true,
      forcePasswordChange: false,
    });
  });
});
