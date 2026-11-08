import { expect, test } from "bun:test";
import { isSessionSetCookie, parseSessionSetCookie, tokenFromCookieValue, withCookieLifetime, withSessionCookieLifetime } from "./session-cookie";

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

test("recognises the session cookie with or without the secure prefix", () => {
  expect(isSessionSetCookie("better-auth.session_token=a.b; Path=/")).toBe(true);
  expect(isSessionSetCookie("__Secure-better-auth.session_token=a.b; Path=/; Secure")).toBe(true);
  expect(isSessionSetCookie("better-auth.session_data=x; Path=/")).toBe(false);
});

test("gives the session cookie the remember-me lifetime, other cookies unchanged", () => {
  const now = Date.UTC(2026, 10, 8, 12, 0, 0);
  const cookie = withCookieLifetime("__Secure-better-auth.session_token=a.b; Max-Age=604800; Path=/; Expires=Sun, 15 Nov 2026 12:00:00 GMT; HttpOnly; Secure", 2592000, now);
  expect(cookie).toBe("__Secure-better-auth.session_token=a.b; Path=/; HttpOnly; Secure; Max-Age=2592000; Expires=Tue, 08 Dec 2026 12:00:00 GMT");
  const headers = new Headers();
  headers.append("set-cookie", "better-auth.session_token=t.s; Max-Age=604800; Path=/; HttpOnly");
  headers.append("set-cookie", "other=1; Max-Age=60; Path=/");
  headers.set("content-type", "application/json");
  const out = withSessionCookieLifetime(headers, 2592000);
  expect(out.getSetCookie()[0]).toStartWith("better-auth.session_token=t.s; Path=/; HttpOnly; Max-Age=2592000; Expires=");
  expect(out.getSetCookie()[1]).toBe("other=1; Max-Age=60; Path=/");
  expect(out.get("content-type")).toBe("application/json");
});
