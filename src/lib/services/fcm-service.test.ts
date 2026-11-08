import { expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  buildServiceAccountJwt, buildWakeUpMessage, isRelayUnregistered, isUnregisteredError, readServiceAccount,
} from "./fcm-service";

test("only a service account key file is accepted, as downloaded (several lines)", () => {
  const file = JSON.stringify({
    type: "service_account",
    project_id: "humble",
    client_email: "push@humble.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
  }, null, 2);
  expect(readServiceAccount(file)?.project_id).toBe("humble");
  expect(readServiceAccount('{"project_id":"humble"}')).toBeNull();
  expect(readServiceAccount('{"project_id":"humble","client_email":"a","private_key":"not a key"}')).toBeNull();
  expect(readServiceAccount("null")).toBeNull();
  expect(readServiceAccount("AIza-not-json")).toBeNull();
});

test("the service account JWT is signed and carries the messaging scope", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = buildServiceAccountJwt({
    client_email: "push@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }, 1000, "https://oauth2.googleapis.com/token");
  const [header, claims, signature] = jwt.split(".");
  expect(JSON.parse(Buffer.from(header, "base64url").toString()).alg).toBe("RS256");
  const body = JSON.parse(Buffer.from(claims, "base64url").toString());
  expect(body.iss).toBe("push@example.iam.gserviceaccount.com");
  expect(body.scope).toContain("firebase.messaging");
  expect(body.exp).toBe(4600);
  const valid = verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url"));
  expect(valid).toBe(true);
});

test("a push carries the alert id and no content", () => {
  const { message } = buildWakeUpMessage("device-fid", "alert-1");
  // The Firebase Installation ID goes in `fid`: `token` is deprecated by FCM
  expect(message.fid).toBe("device-fid");
  expect(message).not.toHaveProperty("token");
  expect(message.android.priority).toBe("HIGH");
  expect(message.data).toEqual({ alertId: "alert-1" });
  expect(message).not.toHaveProperty("notification");
});

test("only Firebase's UNREGISTERED forgets a device", () => {
  // HTTP v1 error body for an installation Firebase no longer knows
  expect(isUnregisteredError({
    error: {
      code: 404,
      status: "NOT_FOUND",
      details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }],
    },
  })).toBe(true);
  // A 404 of a wrong project or URL, another FCM error, no JSON
  expect(isUnregisteredError({ error: { code: 404, status: "NOT_FOUND", message: "Requested entity was not found." } })).toBe(false);
  expect(isUnregisteredError({ error: { details: [{ errorCode: "INVALID_ARGUMENT" }] } })).toBe(false);
  expect(isUnregisteredError(null)).toBe(false);
  expect(isUnregisteredError("<html>Not found</html>")).toBe(false);
});

test("through the relay, only its 410 unregistered answer forgets a device", () => {
  expect(isRelayUnregistered(410, { error: "unregistered" })).toBe(true);
  // A relay address that is wrong, or an older relay
  expect(isRelayUnregistered(404, { error: "not_found" })).toBe(false);
  expect(isRelayUnregistered(404, { error: "firebase_refused", status: 404 })).toBe(false);
  expect(isRelayUnregistered(410, null)).toBe(false);
  expect(isRelayUnregistered(502, { error: "unregistered" })).toBe(false);
});
