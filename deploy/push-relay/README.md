# Push relay

The app registers with Firebase Cloud Messaging by its Firebase Installation ID
(FID), which Firebase ties to the Firebase project of the app build. The
published app can therefore only be reached with that project's key, which
cannot be given to every self-hosted server. This relay holds the key: servers
send `{fid, alertId}`, it forwards a high-priority data message holding the
alert id (HTTP v1 `message.fid`), and the app reads the alert from its own server.

It stores nothing and never receives planning data.

```bash
docker run -d --name hp-push-relay -p 8080:8080 \
  -e FCM_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" \
  -v "$PWD/server.ts:/app/server.ts:ro" -w /app \
  oven/bun:1.4.4 bun server.ts
```

| Variable | Purpose |
|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | Service account of the app's Firebase project (required) |
| `PORT` | Listening port, default 8080 |
| `RELAY_KEY` | When set, servers must send `Authorization: Bearer <key>` |
| `TRUSTED_PROXY` | `cloudflare` only when the relay is reached through the Cloudflare proxy and its port accepts no other connection: the address is then read from `CF-Connecting-IP` |

Serve it behind HTTPS, then set its address in Settings > General > Mobile app >
Push relay address on each server. A server holding its own
`FCM_SERVICE_ACCOUNT_JSON` calls Firebase directly and does not use the relay.

Limits: 600 requests a minute per address, 30 a minute per device (FID), bodies
of 8 KiB at most (checked on `Content-Length` before anything is read). The
address is the one of the connection: without `TRUSTED_PROXY=cloudflare`,
`CF-Connecting-IP` is ignored, since any client reaching the relay directly could
send it. Behind another reverse proxy, every server counts as the proxy's address.
The key is compared in constant time; calls to Google give up after 10 seconds.

`POST /v1/push` answers:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{status: "sent"}` | Sent |
| 410 | `{error: "unregistered"}` | Firebase no longer knows the FID (`UNREGISTERED`: app uninstalled, data cleared). The server forgets this device's token; it is the only answer that does |
| 400 | `{error: "invalid_json" \| "invalid_body"}` | Bad request |
| 401 | `{error: "unauthorized"}` | Missing or wrong key |
| 413 | `{error: "too_large"}` | Body over 8 KiB |
| 429 | `{error: "rate_limited"}` | Limited |
| 502 | `{error: "firebase_refused", status}` or `{error: "firebase_unreachable"}` | Firebase refused or is unreachable |
