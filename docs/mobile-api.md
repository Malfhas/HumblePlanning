# Mobile API

Routes used by the native Android app, under `/api/mobile/`. Everything else the
app needs goes through the regular REST routes and Socket.io.

## Authentication

A mobile session is a regular Better Auth session. Sign-in returns the session
cookie in JSON; the app stores it and sends `Cookie: <cookieName>=<cookieValue>`
on every REST request and on the Socket.io handshake. Revoking it from the web
profile signs the device out.

The app also sends `X-App-Version: <version>` on every request. The web client
never sends this header.

| Route | Auth | Body | Response |
|---|---|---|---|
| `GET /info` | none | | `{service, mobileApiVersion, appTitle, logoLight, logoDark, loginEnabled, pairingEnabled, pushEnabled, forgotPasswordEnabled, alertsEnabled, maintenance, minimumAppVersion, storeUrl}` |
| `POST /auth/login` | none | `{identifier, password, device?}` | see below |
| `POST /auth/2fa` | none | `{pendingToken, code, isBackupCode?, device?}` | see below |
| `POST /auth/pairing` | none | `{code, device?}` | see below |
| `POST /auth/logout` | session | | `{success: true}` |
| `POST /pairing` | browser session | | 201 `{link, expiresAt}` (QR code content) |

`device` is `{name?, platform?, appVersion?, locale?}`. Sign-in answers either
`{status: "two_factor_required", pendingToken}` or
`{status: "authenticated", session: {userId, cookieName, cookieValue, expiresAt}, forcePasswordChange, setupTwoFactorRequired}`.
The app honors the two flags with `POST /api/auth/change-password` and
`POST /api/profile/2fa/enable` then `/verify`.

Sign-in has no captcha, which a native form cannot show. It keeps the lockouts of
the web login, adds a lock per address across accounts (30 failures in 15
minutes lock for 15 minutes), refuses any request with an `Origin` header
(browsers), and can be turned off with `MOBILE_LOGIN_ENABLED`.

## Minimum app version, permission and maintenance

`MOBILE_MIN_APP_VERSION` (empty = none) and `MOBILE_STORE_URL` are in the
settings, under Security > Mobile app. The role permission `mobile_app:use`
(Roles > Mobile app; Super Administrateur, Administrateur and Manager by default)
decides who may use the app. In this order:

| Case | Status | Code | `params` |
|---|---|---|---|
| App older than the minimum, on sign-in and on every authenticated route, when the request carries `X-App-Version` | 426 | `mobile.errors.upgradeRequired` | `{minimumVersion, storeUrl}` |
| Role without `mobile_app:use`: at the end of any sign-in (password, 2FA, QR code; no session is kept), header or not, and on every authenticated route carrying `X-App-Version` (permission withdrawn while signed in) | 403 | `mobile.errors.appNotAllowed` | |
| `MAINTENANCE_MODE` on, without `maintenance:bypass`, on every authenticated route carrying `X-App-Version` | 423 | `mobile.errors.maintenance` | |

Sign-in is not blocked by maintenance: the first authenticated call then answers
423, and `GET /info` exposes `maintenance` beforehand. `GET /info` and
`POST /auth/logout` are never gated.

Without the permission, the web profile shows no QR code (`POST /pairing` answers
the same 403) and the account receives no mobile alert.

## Data

| Route | Auth | Response |
|---|---|---|
| `GET /bootstrap` | session | `{serverTime, user, permissions, isAdmin, config, assistant, statuses, places, projects, users, teams, businessUnits, groups, holidays, resources, vehicles}`, gzipped. A list the role cannot read is `null`. |
| `GET /tasks/sync?startDate&endDate[&since][&businessUnitIds]` | session | `{serverTime, changed: Task[], ids: uuid[]}`. An id missing from `ids` left the range or scope. Pass `serverTime` as the next `since`. |

## AI assistant

The app uses the routes of the web chat, `/api/ai-chat/*`, with its session. The
server calls OpenRouter with the instance's key, so the app holds no key and the
permissions (`ai_chat:use`, `ai_chat:write`), quotas and approval of every write
are the same as on the web. `GET /bootstrap` returns `assistant: {available, canWrite}`;
when `available` is false the app hides the entry.

`POST /api/ai-chat/conversations/{id}/messages` streams the AI SDK UI message
protocol (server-sent events). A write suspends the turn with a tool part in the
`approval-requested` state: the app shows the confirmation, then sends the history
again with that part in the `approval-responded` state.

## Regular routes used by the app

| Need | Routes |
|---|---|
| Tasks | `/api/tasks`, `/api/tasks/{id}` and its `repeat`, `files`, `users/{id}` |
| Attachments | `/api/files/tasks/{taskId}/{name}` |
| Profile | `/api/profile`, `/preferences`, `/password`, `/2fa/enable`, `/2fa/verify`, `/2fa/disable` |
| Language of the account | `/api/locale` |
| Password changes required at sign-in | `/api/auth/change-password` |
| AI assistant | `/api/ai-chat/access`, `/api/ai-chat/conversations*` |
| Real time | Socket.io at `/socket.io/`, session cookie in the handshake; after `permissions:changed` the app reads `/bootstrap` again |

These are the routes the current app calls; the others stay open to any session,
under the same permissions as on the web.

## Devices and push

| Route | Auth | Body | Response |
|---|---|---|---|
| `GET /devices` | session | | `[{id, platform, deviceName, appVersion, pushEnabled, current, createdAt, lastSeenAt}]` |
| `PUT /devices/current` | session | `{name?, platform?, appVersion?, locale?, pushToken?}` | `{id, lastSeenAt, pushEnabled}` |
| `DELETE /devices/{id}` | session | | `{success: true}`, revokes its session |
| `POST /devices/current/push-test` | session | | `{delivered}`: number of the user's devices reached by push (every device with a `pushToken`, not only the current one) |

`pushToken` is the device's Firebase Installation ID (FID), which the app gets from
`FirebaseMessaging.register()` / `onRegistered()` (FCM registration tokens are
deprecated since firebase-messaging 25.1); `null` turns push off for the device.

## Alerts

Task events produce alerts for the mobile app, on the same levels as the e-mails:

| Level | Where |
|---|---|
| Instance on or off | Settings > Security > Mobile app, `MOBILE_PUSH_ENABLED` |
| Events | Same section, `MOBILE_PUSH_TRIGGERS` (empty = all) |
| Per user, by an administrator | User form, `users.mobilePushNotifications` |
| By the user | Web profile or the app: `PUT /api/profile/preferences {mobilePushNotifications}`, read back as `mobilePushNotificationsUser` on the profile |

They do not depend on the in-app bell (`NOTIFICATION_PUSH_ENABLED`). Authors do
not receive their own alerts. Only users with a signed-in device get one.

`GET /alerts[?after]` returns `{serverTime, more, alerts: [{id, type, title, message, actionUrl, createdAt}]}`,
oldest first, at most 100, from the last 7 days. Pass `serverTime` as the next
`after` (inclusive) and ignore ids already shown. With `after`, a full page returns
`more: true` and the `createdAt` of its last alert as `serverTime`: call again to
read on. Without `after` (the history), it returns the latest 100. Each alert also
goes out as:

- the Socket.io event `mobile:alert` `{alertId}`, while the app is connected;
- a high-priority Firebase data message `{alertId}`, which wakes the app even when
  it is closed; the app then reads the alert here, so no planning data goes
  through Firebase.

The push targets the device's FID (HTTP v1 `message.fid`). Firebase ties a FID to
the Firebase project of the app build, so a server sends the push in one of two ways:

| Setting | Use |
|---|---|
| `FCM_SERVICE_ACCOUNT_JSON`, in `.env` or pasted in Settings > Security > Mobile app (`.env` first) | The server owns the app's Firebase project and calls Firebase itself |
| `MOBILE_PUSH_RELAY_URL`, optional `MOBILE_PUSH_RELAY_KEY` | The server goes through the relay of the published app, see `deploy/push-relay` |

With neither, or for a build without Firebase, the app polls `/alerts` in the
background, as often as Android allows (about every 15 minutes).

