import { expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { buildServiceAccountJwt, buildWakeUpMessage, readServiceAccount } from "./fcm-service";

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
