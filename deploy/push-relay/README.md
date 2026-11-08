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

Serve it behind HTTPS, then set its address in Settings > Security > Mobile app >
Push relay address on each server. A server holding its own
`FCM_SERVICE_ACCOUNT_JSON` calls Firebase directly and does not use the relay.

Limits: 600 requests a minute per address, 30 a minute per device (FID). The
address is the one of the connection: without `TRUSTED_PROXY=cloudflare`,
`CF-Connecting-IP` is ignored, since any client reaching the relay directly could
send it. Behind another reverse proxy, every server counts as the proxy's address.

`POST /v1/push` answers 200 when sent, 404 when Firebase no longer knows the FID
(`UNREGISTERED`: the server then forgets it), 429 when limited, 502 when Firebase
refused or is unreachable.
