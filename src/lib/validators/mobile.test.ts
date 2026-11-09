import { expect, test } from "bun:test";
import { mobileDeviceSchema, updateMobileDeviceSchema } from "./mobile";

test("the Android and iOS apps register their platform", () => {
  expect(mobileDeviceSchema.parse({ platform: "android" }).platform).toBe("android");
  expect(mobileDeviceSchema.parse({ platform: "ios" }).platform).toBe("ios");
  expect(mobileDeviceSchema.parse({}).platform).toBeUndefined();
  expect(mobileDeviceSchema.safeParse({ platform: "windows" }).success).toBe(false);
});

test("the device update of an app accepts both platforms too", () => {
  expect(updateMobileDeviceSchema.parse({ platform: "ios", pushToken: null }).platform).toBe("ios");
  expect(updateMobileDeviceSchema.safeParse({ platform: "web" }).success).toBe(false);
});
