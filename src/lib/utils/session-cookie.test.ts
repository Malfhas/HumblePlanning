import { expect, test } from "bun:test";
import { parseSessionSetCookie, tokenFromCookieValue } from "./session-cookie";

test("reads the secure cookie and keeps its raw value", () => {
  const cookie = parseSessionSetCookie(["__Secure-better-auth.session_token=abc.d%2Be%3D; Path=/; HttpOnly; Secure"]);
  expect(cookie).toEqual({ name: "__Secure-better-auth.session_token", value: "abc.d%2Be%3D" });
});

test("reads the plain cookie among several joined headers", () => {
  const cookie = parseSessionSetCookie(["other=1; Path=/, better-auth.session_token=tok.sig; Path=/"]);
  expect(cookie).toEqual({ name: "better-auth.session_token", value: "tok.sig" });
});

test("ignores a deleted cookie and other cookies", () => {
  expect(parseSessionSetCookie(["better-auth.session_token=; Max-Age=0"])).toBeNull();
  expect(parseSessionSetCookie(["better-auth.session_data=x; Path=/"])).toBeNull();
  expect(parseSessionSetCookie([])).toBeNull();
});

test("extracts the token from a signed value", () => {
  expect(tokenFromCookieValue("abc.d%2Be%3D")).toBe("abc");
});
