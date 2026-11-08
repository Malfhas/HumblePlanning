# Mobile API

Routes used by the native Android app, under `/api/mobile/`. Everything else the
app needs goes through the regular REST routes and Socket.io.

## Authentication

A mobile session is a regular Better Auth session. Sign-in returns the session
cookie in JSON; the app stores it and sends `Cookie: <cookieName>=<cookieValue>`
on every REST request and on the Socket.io handshake. Revoking it from the web
profile signs the device out: `session:revoked` goes to every session of the
user (see [Real time](#real-time)).

The app also sends `X-App-Version: <version>` on every request. The web client
never sends this header.

| Route | Auth | Body | Response |
|---|---|---|---|
| `GET /info` | none | | `{service, mobileApiVersion, appTitle, logoLight, logoDark, loginEnabled, pairingEnabled, pushEnabled, forgotPasswordEnabled, alertsEnabled, maintenance, minimumAppVersion, storeUrl}` |
| `POST /auth/login` | none | `{identifier, password, device?}` | see below |
| `POST /auth/2fa` | none | `{pendingToken, code, isBackupCode?, device?}` | see below |
| `POST /auth/pairing` | none | `{code, device?}` | see below |
| `POST /auth/logout` | session | | `{success: true}` |
| `POST /pairing` | browser session | | 201 `{link, expiresAt}` (QR code content), see [QR code](#qr-code) |

`device` is `{name?, platform?, appVersion?, locale?}`. Sign-in answers either
`{status: "two_factor_required", pendingToken}` or
`{status: "authenticated", session: {userId, cookieName, cookieValue, expiresAt}, forcePasswordChange, setupTwoFactorRequired}`.
The app honors the two flags with `POST /api/auth/change-password` and
`POST /api/profile/2fa/enable` then `/verify`.

Sign-in has no captcha, which a native form cannot show. It keeps the lockouts of
the web login, adds a lock per address across accounts (30 failures in 15
minutes lock for 15 minutes), refuses any request with an `Origin` header
(browsers), and can be turned off with `MOBILE_LOGIN_ENABLED`.

- Each attempt is reserved on every lock before the password (or QR code) is
  checked, so parallel requests cannot try more than a lock allows.
- The address lock counts an IPv4 address as it is and an IPv6 address by its
  /64 prefix (an IPv4-mapped IPv6 address counts as the IPv4 one). It counts
  every wrong password, including the one that starts a lock of the account
  (answered 429), and every rejected QR code; never a success.
- An existing, active account whose role lacks `mobile_app:use` is refused
  (403 `mobile.errors.appNotAllowed`) before its password is checked: the answer
  says nothing about the password, opens no session and counts no failure.
- `POST /auth/2fa` is off with `MOBILE_LOGIN_ENABLED` like the first step, and only
  accepts a `pendingToken` returned by `POST /auth/login` (a token of the web
  sign-in answers like an unknown one).

Errors of the sign-in routes (body `{error, code, params?, details?}`, `error`
translated):

| Status | Code | Routes | When |
|---|---|---|---|
| 403 | `errors.invalidOrigin` | all three | `Origin` header present |
| 426 | `mobile.errors.upgradeRequired` | all three | see [Minimum app version](#minimum-app-version-permission-and-maintenance) |
| 403 | `mobile.errors.loginDisabled` | `/auth/login`, `/auth/2fa` | `MOBILE_LOGIN_ENABLED` off |
| 403 | `mobile.errors.pairingDisabled` | `/auth/pairing` | `MOBILE_PAIRING_ENABLED` off |
| 429 | `auth.errors.tooManyAttemptsMinutes` (`params.count` minutes) or `…Seconds` | all three | address, account or second-factor lock |
| 422 | `errors.invalidData` (`details`: the failed checks) | all three | invalid body |
| 401 | `auth.errors.invalidCredentials` | `/auth/login` | wrong login or password |
| 401 | `mobile.errors.invalidPairingCode` | `/auth/pairing` | unknown, expired or used code, or account disabled |
| 401 | `auth.errors.sessionExpired` | `/auth/2fa` | pending token unknown, expired (5 minutes), used, or not from `/auth/login` |
| 400 | `auth.errors.invalidCode`, `invalidBackupCode`, `codeAlreadyUsed`, `twoFactorNotConfigured`, `invalidToken` | `/auth/2fa` | second factor refused |
| 403 | `auth.errors.accountDisabled` | `/auth/login` | inactive account (right password) |
| 403 | `mobile.errors.appNotAllowed` | all three | role without `mobile_app:use` |

## QR code

`POST /pairing` creates a single-use code valid 5 minutes, shown as a QR code by
the web profile. Only a page of the web site may create one: the request must be
same-origin (`Origin` naming the server, or `Sec-Fetch-Site: same-origin`, else
403 `errors.invalidOrigin`) and carry a web session, neither an API key nor the
session of a mobile device (403 `mobile.errors.webOnly`). Other answers: 401
`errors.unauthenticated`, 403 `mobile.errors.pairingDisabled`, 403
`mobile.errors.appNotAllowed`, 429 `errors.rateLimited` (more than 10 codes in 10
minutes). Each code created is recorded in the audit (who, from which address;
never the code).

## Minimum app version, permission and maintenance

The minimum app version is the one of the server release
(`RELEASE_MIN_APP_VERSION` in `src/lib/utils/app-version.ts`, 1.0.0 today), or the
`MOBILE_MIN_APP_VERSION` setting when it is newer: the setting can only raise it.
`GET /info` returns the version enforced in `minimumAppVersion` (never `null` since
this rule). **Maintainers:** when a server release changes the API in a way an older
app cannot handle, raise `RELEASE_MIN_APP_VERSION` in that release (and say so in
the changelog): every server applies it with its update, without any setting.
`MOBILE_MIN_APP_VERSION` and `MOBILE_STORE_URL` are in the settings, under
Security > Mobile app. The role permission `mobile_app:use`
(Roles > Mobile app; Super Administrateur, Administrateur and Manager by default)
decides who may use the app. In this order:

| Case | Status | Code | `params` |
|---|---|---|---|
| App older than the minimum, on sign-in and on every authenticated route, when the request carries `X-App-Version` | 426 | `mobile.errors.upgradeRequired` | `{minimumVersion, storeUrl}` |
| Role without `mobile_app:use`: on any sign-in (password: before the password is checked; 2FA, QR code; no session is kept, a failed login is recorded in the audit), header or not, and on every authenticated route carrying `X-App-Version` (permission withdrawn while signed in) | 403 | `mobile.errors.appNotAllowed` | |
| `MAINTENANCE_MODE` on, without `maintenance:bypass`, on every authenticated route carrying `X-App-Version` | 423 | `mobile.errors.maintenance` | |

Sign-in is not blocked by maintenance: the first authenticated call then answers
423, and `GET /info` exposes `maintenance` beforehand. `GET /info` and
`POST /auth/logout` are never gated.

Without the permission, the web profile shows no QR code (`POST /pairing` answers
the same 403), the account receives no mobile alert and cannot send a test push.

## Data

| Route | Auth | Response |
|---|---|---|
| `GET /bootstrap` | session | `{serverTime, user, permissions, isAdmin, config, assistant, statuses, places, projects, users, teams, businessUnits, groups, holidays, resources, vehicles}`, gzipped. A list the role cannot read is `null`. |
| `GET /tasks/sync?startDate&endDate[&since][&businessUnitIds]` | session | `{serverTime, changed: Task[], ids: uuid[]}`, gzipped. An id missing from `ids` left the range or scope. Pass `serverTime` as the next `since`. |

`GET /tasks/sync`:

- `startDate` and `endDate` are calendar dates (`YYYY-MM-DD`, a real day), `since` an
  ISO date-time with its offset, `businessUnitIds` comma-separated uuids; anything
  else answers 422 `errors.invalidData` with `details`. Without one of the pages
  `pages:tasks`, `pages:planning` or `pages:home`: 403 `errors.forbidden`.
- `serverTime` is 5 seconds before the read started, so that a task saved while it
  ran is not skipped: a task can come back in `changed` once more. Merge by id.
- `changed` holds the tasks changed since `since` (all of them without it). Adding
  or removing an assignee counts as a change. The `notes` of a task are cut to
  200 characters (followed by `…`): read `GET /api/tasks/{id}` for the full task,
  which also has the fields the sync leaves out (link, recurrence, files).

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
| Real time | Socket.io at `/socket.io/`, see [Real time](#real-time) |

These are the routes the current app calls; the others stay open to any session,
under the same permissions as on the web.

## Real time

Socket.io at `/socket.io/`, with the session cookie in the handshake. A refused
handshake gives one of the connect errors `Not authenticated`, `Invalid session`,
`Session expired`, `User not found`. Events the app uses: `task:changed`,
`permissions:changed` and `ai-chat:availability` (read `/bootstrap` again),
`mobile:alert` `{alertId}`, `session:revoked`.

`session:revoked` goes to every session of the user whenever one of them ends
(revoked from the web profile or `DELETE /devices/{id}`, password changed, account
disabled or deleted): call any authenticated route, only a 401 means this session
ended. The server also closes the connections of the ended sessions at once, and
every 5 minutes those of expired ones (a disconnection by the server, which the
client does not retry).

## Devices and push

| Route | Auth | Body | Response |
|---|---|---|---|
| `GET /devices` | session | | `[{id, platform, deviceName, appVersion, pushEnabled, current, createdAt, lastSeenAt}]` |
| `PUT /devices/current` | session, app only | `{name?, platform?, appVersion?, locale?, pushToken?}` | `{id, lastSeenAt, pushEnabled}` |
| `DELETE /devices/{id}` | session | | `{success: true}`, revokes its session |
| `POST /devices/current/push-test` | session | | `{delivered}`: number of the user's devices reached by push (every device with a `pushToken`, not only the current one) |

- `PUT /devices/current` only registers the device of a request carrying
  `X-App-Version`: without it (a browser), 403 `mobile.errors.appOnly`. Invalid
  body: 422 `errors.invalidData`.
- `DELETE /devices/{id}`: 400 `errors.invalidId`, 404 `mobile.errors.deviceNotFound`
  when it is not one of the user's devices.
- `POST /devices/current/push-test`: 401 `errors.unauthenticated` with an API key,
  403 `mobile.errors.appNotAllowed` without `mobile_app:use`, 503
  `mobile.errors.pushNotConfigured` when the server has neither a Firebase service
  account nor a relay, 429 `errors.rateLimited` after 5 tests in 10 minutes.

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
not receive their own alerts. Only users with a signed-in device whose session
has not expired get one, and only those devices get the push.

`GET /alerts[?after]` returns `{serverTime, more, alerts: [{id, type, title, message, actionUrl, createdAt}]}`,
oldest first, at most 100, from the last 7 days. Pass `serverTime` as the next
`after` (inclusive) and ignore ids already shown: `serverTime` is 5 seconds before
the read started, so an alert can come back once more. With `after`, a full page
returns `more: true` and the `createdAt` of its last alert as `serverTime`: call
again to read on. Without `after` (the history), it returns the latest 100. An
`after` that is not an ISO date-time with its offset answers 422
`errors.invalidData` (leave it out rather than sending it empty). Each alert also
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

A device's `pushToken` is forgotten (`pushEnabled` becomes false, the device stays
signed in) only when Firebase reports the installation as `UNREGISTERED`; through
the relay, only on its 410 `{error: "unregistered"}` answer. The app then sends
its new FID from `onRegistered()`.

With neither, or for a build without Firebase, the app polls `/alerts` in the
background, as often as Android allows (about every 15 minutes).
