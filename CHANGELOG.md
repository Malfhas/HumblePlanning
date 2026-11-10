# Changelog

All notable changes to Humble Planning are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-11-10

### Added

- Redesigned emails: the logo of the instance and a label at the top, a rule in the theme colour, the task details in a box, a button to open the schedule, and a footer saying the email is automatic and not to reply to it; the layout adapts to phones. The logo (the one uploaded in *Settings > Appearance*, or the default one) is served by the instance as a small PNG (`/api/branding/email-logo`, a few kilobytes): it needs `APP_BASE_URL` to be reachable by the mail clients, otherwise the name of the application is shown instead.
- *Settings > Appearance > Theme colour*: the accent colour of the emails and of the PDF and Excel exports, the Humble Planning violet by default. Text drawn on it or with it stays readable whatever the colour chosen.
- *System health*: the date and time of the server, in the time zone of the instance with its UTC offset; the card turns orange when the server clock is more than a minute away from the one of the device.
- AI assistant: a conversation reopened later shows again the reasoning of the model, the tools it used with their parameters and results, and its intermediate texts, as they were seen live (replies from before this version show their text only).

### Changed

- AI assistant:
  - reasoning steps and tool calls that follow one another are grouped on a single line that unfolds ("6 reasoning steps and 6 tools used · list-users ×4, get-user-schedule…"); a tool called several times is listed once with its count;
  - the reply after an approved write is shown in the same message as the request for approval, also when the conversation is reopened;
  - a slightly wider column (832 px) and less space between a question and its answer.
- *AI usage*: an approved write is now recorded as executed (or rejected, or failed) with its result, instead of staying "proposed".
- Caddy 2.11.9 (security fixes in the reverse proxy). The application image installs the Debian security updates at each build. Next.js 16.4.6, Better Auth 1.7.20, AI SDK 7.0.168, next-intl 4.14.10 and other patch updates.

### Fixed

- Times written by the server were in UTC instead of the time zone of the instance (for example "sent at 16:21" for an email sent at 17:21 in Paris): emails, export file names, "today" in the statistics, exports and assistant tools, the week of the weekly summary, and the times of the scheduled backups and of the weekly summary now follow the *Time zone* setting (with "Automatic", the time zone of the server).
- iCal export: with the "Automatic" time zone, the calendar was given an invalid time zone; all-day events no longer shift by a day.
- Initials in the avatars: a name followed by a qualifier in brackets, such as "(Alternant)" or "[Intérimaire]", showed "(" instead of the initials; the letters were slightly off-centre in the circles of the schedule; *My account* showed the first letters of the last name only ("RO" instead of "AR").
- Schedule: the tooltip of a user, project or vehicle near the bottom of the screen was cut; it now rises to stay visible.
- Schedule: switching from users to projects after scrolling down left the top of the list hidden; the list now starts again from its top, and a shorter content (filter, folded group) never leaves a blank area.

## [1.3.0] - 2026-11-09

### Added

- *Administration > System health* (replaces *Logs*; `/logs` leads there): live status of the database, the real-time server and email delivery, configuration alerts, scheduled tasks with their last and next run, incidents grouped with their number of occurrences, failed deliveries, and a purge by date. New permissions `pages:system_health` and `system_health:purge`, given to Administrateur by the update.
- *Administration > AI usage* (`/ai-history`): the assistant conversations of everyone, with their cost and usage charts, and a purge by date. New permissions `pages:ai_history` and `ai_history:purge`, given to Administrateur by the update.
- Daily automatic purge at 3 am: assistant history after 365 days and system incidents after 30 days by default (*Settings > System > History*).
- Server log: INFO and above go to the standard output (`docker logs`), warnings and errors are also kept on the System health page; `LOG_DEBUG=true` in `.env` adds the DEBUG messages.
- Calendar (formerly "Personal calendar"):
  - a Month view: week numbers, tasks over several days as continuous bars, "+N more", today, holidays and weekends; a click on a day opens it, a click on a task opens the task;
  - an "All users" option: each task once with the initials of its people, and a "busy / shown" badge;
  - the planned hours of each day in its header, real-time updates, the people of a task in its tooltip, a person picker with photo and full name, the chosen mode remembered.
- Project Gantt export, in PDF and Excel: pick a project (same list and permissions as the task form); one row per task title (case and spaces ignored; untitled tasks on a row named after the project), bars in the colour of their status, milestones as diamonds; sorted by date or by title, by day or by week, with an optional line for today.
- Milestones: a "Milestone" switch next to the status in the task form; a milestone icon at the end of the task in the schedule and the Calendar, and a "Milestone" line in the tooltip.
- A notes icon at the end of the tasks that have notes.
- Delete key: deletes the selected task, with the same confirmation as the context menu.
- PDF export: a "Full names" option (names wrap instead of ending with "…"), and the Month view of the Calendar.
- Mobile app: the QR code that signs the app in can be renewed (at most every 30 seconds while it is valid, at once when it has expired).

### Changed

- AI assistant:
  - conversation titles are written in the language of the interface and are never left as "New conversation";
  - the scope selector is gone: the assistant always works on the whole schedule, within the rights of the person; a conversation tied to a project now covers everything, and the project sent by an app is ignored;
  - a wider home, the model menu shows the logo of the model and what it can read, the conversation list can be resized (double-click on its edge to reset it), messages use the schedule font at 14 px with airier answers, and the sphere is softer and livelier under the mouse;
  - the "may make mistakes" warning is removed.
- Windows: the title, the close button and the buttons stay visible; only the content scrolls.
- List pages share one toolbar (filters on the left, actions on the right next to the table); Teams and Groups are framed by business unit.
- Menu: *Administration* holds Settings, Roles, Holidays, Files, Audit, AI usage and System health; *Analysis* keeps the statistics and the export.
- Schedule: the Team/day view and its permission `planning:view_team_day` are removed; a "Schedule · Users ▾" tab switches between people and projects. The attachment icon moves to the end of the task, before the notes and milestone icons. The "Real time" badge (formerly "Live") comes before the avatars of the people online.
- PDF export: the Inter font, adjusted sizes, taller task bars and wider cells; a large logo no longer makes the file heavy and slow. The Calendar export covers the period of its view (the whole month in Month view).
- *Settings*: the *Mobile app* section moves from *Security* to *General*; the system prompt field scrolls; clearer wording of a few settings.
- New installations: the schedule uses Inter at 11 px with 135 px columns, and passwords require a special character. Existing instances keep their settings.
- The sign-in captcha (ALTCHA) is solved in under a second on a recent computer, instead of about 3 seconds.
- Minimum mobile app version: 1.0.2. An older app is asked to update: publish [Humble Planning for Android 1.0.2](https://github.com/Malfhas/HumblePlanning-Android/releases/tag/v1.0.2) to your users before updating the server.

### Fixed

- An invalid page or limit in the query of an API list (for example `/api/audit?page=abc`) answered 500 instead of 422.
- Scheduled backups: turning them on, or changing their frequency or time, now takes effect without restarting the server.
- Every page downloaded all the vehicle and resource assignments ever made, even with no task open.
- The schedule downloaded the list of visible people twice.
- Schedule: going to Vehicles or Resources and back showed the scrollbars of the previous view until the mouse moved over the grid.
- Settings: the section menu on the left moved up when the page scrolled.
- Calendar: text cut at the bottom of the bars, initials not aligned, tooltip going off the screen.
- Copy buttons now also work on an instance served over plain HTTP.

### Removed

- The *Logs* page and its settings (logging on or off, level, number of entries kept): System health replaces them, and the update removes the old settings.
- API routes `GET /api/logs` (replaced by `/api/system-health`) and `GET /api/ai-chat/scope-projects` (no more scope).

## [1.2.3] - 2026-11-09

### Added

- Mobile API ready for the native iOS app (in development): devices of the `ios` platform are accepted, and the app identifies itself with the `X-App-Platform: ios` header. Without it, as with the Android app, the server answers as before: the Android app needs no update.
- *Settings > Security > Mobile app*: an "iOS app download page" setting next to the Android one. It holds the app's App Store page, which an outdated iOS app opens; it stays empty until the app is published.

### Changed

- Push stays for Android devices: the iOS app is told it has no push, and the token of an iOS device is never sent, until push through Apple's APNs is added.
- `humble-planning update` removes `TRUST_PROXY_COMPRESSION` from `.env`: since 1.2.2 the reverse proxy compresses the responses and the setting is no longer read.
- README: a screenshot of the installer and a word on Caddy, the reverse proxy it sets up.

## [1.2.2] - 2026-11-09

### Changed

- The API sends its JSON uncompressed and leaves compression to the reverse proxy, as Next.js 16.4.5 no longer lets the application do it. Instances served by Caddy, as set up by the installer, already compress every response: nothing changes for them. Behind your own reverse proxy, turn compression on there: with nginx, the `gzip` lines now in the installer's `nginx-example.conf` and in `docs/installation.md`; with Apache, `mod_deflate`. Without it, the schedule of a long period travels uncompressed (several MB). The `TRUST_PROXY_COMPRESSION` setting is no longer read and can be removed from `.env`.
- Dependencies updated: Next.js 16.4.5 (a security release of Next.js), Better Auth 1.7.18, AI SDK 7.0.166, Tiptap 3.33, TanStack Query 5.107, lucide-react 1.70, zustand 5.1, nodemailer 10.4, otplib 13.6, isomorphic-dompurify 4.7, vanilla-cookieconsent 3.3, Tailwind CSS 4.3.5 and ESLint 10.14.

### Fixed

- Recurring tasks: deleting the first task of a series on its own turned the other occurrences into separate tasks and lost the repetition rule. This happened with "This occurrence", a multiple deletion, a purge, the deletion of the only person assigned to it, or "Whole series" and "This and following" when some occurrences are locked or out of reach. The next occurrence now takes over the series and its rule; a single remaining occurrence becomes a simple task.

## [1.2.1] - 2026-11-08

### Added

- Header: a "Mobile app" button (when QR sign-in is on and the role may use the app) opens a window with the QR code to download the Android app and the QR code that signs it in.

### Changed

- Schedule: when the start of a multi-day task scrolls under the sidebar, its title and icons stay at the left edge of the grid, with an arrow telling that the task goes on.
- AI assistant: a reload of the page (F5) opens the assistant page and the floating assistant on their home instead of the last conversation; links to a conversation and the browser history still open it.
- Settings: the Firebase service account is a multi-line field with an "Import from a file" button; the minimum app version and the download page show the values the server applies when they are empty.
- Settings: "Save" is only enabled when the form differs from the saved values (also in the AI chat settings); the title, the tabs and "Save" stay in place while a section scrolls.

### Fixed

- Settings: the "Mobile app" section made the whole page scroll (double scrollbar).

## [1.2.0] - 2026-11-08

### Added

- Mobile API for the native Android app, [Humble Planning for Android](https://github.com/Malfhas/HumblePlanning-Android): sign-in by password (with the second factor) or by scanning a QR code from the web profile, start-up data and incremental sync of the schedule, real-time alerts with optional push (the instance's own Firebase project, or a push relay: `deploy/push-relay`), devices listed and signed out from the profile and the app. The contract for clients is `docs/mobile-api.md`.
- Role permission "Use the mobile app" (`mobile_app:use`): granted to Administrateur and Manager (Super Administrateur always has it), not to Membre+ and Membre; the web is not affected.
- *Settings > Security > Mobile app*: password sign-in, QR sign-in, alerts and their events, push (Firebase service account or relay), minimum app version, download page. Users get a "Mobile app alerts" switch in their preferences, and administrators one per user.
- Minimum app version shipped with each server release (1.0.0 for this one): an update of the server applies it by itself; the setting can only raise it.
- Demo instances: visitors can try the mobile app with the demo account; no push leaves a demo.
- Secret settings (SMTP password, Mailgun, Nuntly and Sent.dm keys, captcha secret key, OpenRouter key, Firebase service account, relay key) are encrypted in the database with `CONFIG_ENCRYPTION_KEY` (AES-256-GCM). `humble-planning update` adds the key to the `.env` of an existing instance (an existing value is never changed) and the values already stored are encrypted at the start of the new version; a rollback to an older version decrypts them first. See "Secret settings" in `docs/installation.md`.

### Changed

- Signing a session out (from the profile, after a password change, or when a phone is signed out) now ends it at once in the browsers that used it, through the real-time connection; the other tabs of the same account stay signed in.
- Saving a user no longer turns their own notification preferences (e-mail, push, SMS, mobile alerts) back on; that only happens when an administrator switches a channel from off to on.
- Removing a person from a task (or from occurrences of a recurring task) updates the task's modification date, so that synchronised copies see it.
- README: logo shown on GitHub (PNG versions), link to the Android app with screenshots.

### Fixed

- "Remember me" at sign-in had no effect: the session and the browser cookie now last the remember-me duration (30 days by default), also after the second factor.
- Emptying an end date or a time in the task form kept the old value.

### Security

- The detail of a task, task changes and their real-time events carried the full records of the people assigned (phone, address, contract, hourly rate, last sign-in…) to anyone who could read the task: they now carry the same public fields as the task list.
- Attachments of a locked task could be added or deleted without the right to lock tasks.
- Brute-force lockouts hold under parallel requests: each sign-in attempt is counted before the password is checked (same thresholds and messages as before).
- Revoked and expired sessions are disconnected from the real-time server, not only refused by the API.
- Password reset links are only looked up among password reset requests.

## [1.1.3] - 2026-11-02

### Changed

- ALTCHA captcha (sign-in, forgot password, password reset): the box spans the form like its inputs, with their height, border and radius and the colors of the theme in light and dark mode. The ALTCHA logo is no longer inside the box; a "Protected by ALTCHA" notice, in the language of the interface, sits under it.
- `unpdf` 2.1.0, used to extract the text of PDF attachments in the AI chat (same text as before).

## [1.1.2] - 2026-11-01

### Added

- `humble-planning update` brings the scripts of the target release along: before touching any instance, it installs the `humble-planning` command of that release (the previous one kept as `humble-planning.prev`) and runs it again; each updated instance gets the Compose files of its new version, checked before use and put back by the automatic rollback or `humble-planning rollback`; the shared proxy gets its Compose file and site template when its image moves forward. Never older than the newest version installed on the server; a download or check failure only warns and the update goes on. With `HUMBLE_PULL=0`, nothing is fetched.

### Changed

- Servers no longer need the installer to get the changes of the command and of the Compose files: `update` (and the nightly `--auto`) applies them. A server on 1.1.1 or older needs the installer once to get this command.

### Fixed

- Settings: after a save, the panels computed from the settings follow at once (the Nuntly webhook card kept showing "Secret not configured" until the page was reloaded): every query is refreshed, not only the settings themselves.
- Settings > AI chat: the model picker uses the searchable list of the application instead of the browser's native list (dark, unstyled); a model ID absent from the OpenRouter catalogue can still be typed.

## [1.1.1] - 2026-11-01

### Added

- `humble-planning set-url [instance] <url>` changes the public URL of an instance: `.env`, site of the shared reverse proxy (checked, then reloaded; a hand-edited site is kept as a backup), Cloudflare token checked against the new zone, restart and health check, everything restored if a step fails.
- Maintenance page of the shared reverse proxy: while the application of an instance does not answer (update, restart), its pages show a Humble Planning page (status 503, in four languages) that reloads by itself once the application is back; API and real-time requests get a bare 503. The sites created by 1.1.0 get it when the proxy moves to 1.1.1, without any other change to their file.

### Changed

- Container logs are rotated (5 files of 10 MB per container) for new installations and when the installer runs again: with Docker's default settings, they grew until the disk was full.
- The `Strict-Transport-Security` header no longer includes `preload`: adding a domain to the browsers' preload list (all its subdomains forced to HTTPS for months) is the decision of its owner, not of an application installed on it. One year with `includeSubDomains` is kept.

### Fixed

- The application URL used in e-mails (password reset, generated passwords of new accounts, notifications, weekly summary) and shown in Settings > Application kept `http://localhost:3000` after an installation. The URL set by the installer (`APP_BASE_URL` in `.env`) now applies everywhere; the field shows it, read-only.

### Security

- The authentication routes (sign-in, second factor, password reset and forced password change, reset e-mail sent by an administrator) refuse requests sent by another site: a page elsewhere could sign a visitor in to an account of its choice (login CSRF) or trigger reset e-mails.

## [1.1.0] - 2026-11-01

### Added

- Several instances on one server, each with its own name, label, domain, database, files, backups and version. Running the installer again lists the instances and offers to update one of them or to install a new one; in a script, `HP_ACTION`, `HP_NAME` and `HP_LABEL` choose. The loopback ports of a new instance are chosen automatically.
- One Caddy reverse proxy shared by all the instances of a server, from the first installation on: one site file per instance, checked with `caddy validate` before every hot reload and restored when the check fails, a Cloudflare API token per site kept by the proxy only, and an image that follows the newest version installed on the server.
- `humble-planning list`, and an instance name for every command (`humble-planning status <instance>`). Without a name, with several instances, the command asks in a terminal and stops with the list in a script.
- `humble-planning new` installs another instance without the `curl` command: it downloads the installer of the latest published release, checks it, and runs it for a new instance (the `HP_*` variables give a non-interactive installation).
- `humble-planning update` updates several instances one after the other (`--all`, several names, or a choice from the list in a terminal), each with its own pre-update backup and automatic rollback, then prints the result of each one.
- `humble-planning remove <instance>`: final database backup kept in `/var/backups/humble-planning`, confirmation by typing the name, then removal of the containers, volumes, files, proxy site, Cloudflare token and nightly update of the instance; the shared proxy can go with the last instance that uses it.
- `humble-planning proxy status|logs|restart|reload` for the shared reverse proxy.
- Nightly automatic updates per instance (`humble-planning-update@<instance>.timer`, or one cron entry per instance).
- Settings > Version shows the update command with the name of the instance.

### Changed

- An installation made with 1.0.x is taken over by the installer: registered as an instance without moving its directory, Compose project or volumes, its Caddy moved into the shared proxy with its certificates (its own Caddy serves the site again if the takeover fails), and its nightly update timer replaced by the one of the instance. `humble-planning update` on a 1.0.x installation still updates it in place, without multi-instance support: run the installer once to get it.
- The web application reaches its Socket.io server as `socket.internal`, a name that only exists on the private network of its instance.

## [1.0.1] - 2026-10-31

### Security

- Demo mode: the shared demo account lists only the visitor's own session. The IP addresses and browsers of the other visitors are no longer visible.

### Changed

- The ALTCHA captcha protects sign-in and password reset by default when its secrets are set (the installer generates them). It is turned on at the next start of existing installations too, unless an administrator already chose a setting or another provider.

## [1.0.0] - 2026-10-31

First open-source release of Humble Planning, under the GNU Affero General Public License v3.0 or later.

### Schedule

- Real-time schedule grid shared by every user, with live presence of the people currently connected.
- Day and hour views, with views by people, projects, vehicles and resources, a team/day view and a personal calendar.
- Drag and drop to move tasks, resize to change their dates, copy and paste, half-day tasks (morning or afternoon) and tasks with start and end times.
- Multi-person tasks, recurring tasks (daily, weekly, monthly) that skip or shift around holidays and weekends, and milestones.
- Grouping by business unit and team, custom sort orders, filters, adjustable cell width and custom scrollbars that never hide the last row.
- Public holidays shown on the grid, weekends highlighted, ISO week numbers.
- Hover cards with each person's job title, team, contact details and qualifications.

### Tasks

- Task list with search, filters and sorting.
- Custom statuses, notes, file attachments, task locking and full change history.
- Configurable daily task limit per person.

### People and organisation

- Users with job titles, contract types (employee, temporary worker, subcontractor, apprentice, intern, freelancer), hourly rates and visibility on the schedule.
- Teams, business units with their address on a map, qualifications and labour types.
- Roles with fine-grained permissions and scopes that limit which people and projects each role sees and can change (everything, business unit, team or own), with five built-in roles.

### Projects and worksites

- Projects with job numbers, groups, statuses, colours, descriptions, delivery dates and the site address on a satellite map.
- Labour budgets in hours and cost, per labour type, compared with planned and consumed hours.
- Project archiving and duplication.

### Logistics

- Vehicles and vehicle types, resources and resource types.
- Assignments shown on the schedule, with their own views.
- Vehicle and resource modules that can be switched off when not needed.

### Analytics

- User statistics: workload, occupancy rate, hours by labour type.
- Project statistics: consumed, upcoming and remaining hours, overall progress.
- Return on investment: revenue, labour cost and margin by project.
- Period presets (month, quarter, year, last 12 months) and filters by business unit, team, user and project.

### Exports and calendars

- PDF export of the schedule as a grid or a list, with paper size, orientation, fit-to-page and optional statistics pages.
- Excel and CSV exports.
- Personal iCal feeds to follow one's schedule from any calendar application.

### Notifications

- In-app notifications with a notification centre.
- E-mail notifications on task changes through SMTP, Mailgun or Nuntly, and a weekly summary e-mail.
- Push notifications, and SMS or WhatsApp messages through Sent.dm.

### AI assistant

- Built-in AI assistant, available as a full page and as a floating assistant on every screen.
- Answers questions from live data: availability, workload, planned hours, holidays.
- Prepares changes (create, move, copy, update or delete a task, create or update a project) that are applied only after the user approves them in a confirmation card.
- Works with the signed-in user's permissions only; access is granted per role, read-only or read and write.
- Models chosen by the administrator through OpenRouter, with privacy options (providers that keep no data, no data collection) and a monthly spending quota per user.
- Conversations with history, pinning and automatic titles, PDF and image attachments, and local voice dictation (Whisper, run in the browser).
- Switches on automatically as soon as an API key and a model are configured.

### MCP server

- Model Context Protocol server at `/api/mcp` with 40 tools covering tasks, projects, users, availability, statistics, vehicles and resources.
- Works with Claude, ChatGPT, Copilot and any MCP client, through OAuth 2.1 with a sign-in and consent screen, or through personal API keys.
- Every call runs with the user's permissions; write tools require a dedicated permission.

### Security and compliance

- Argon2id password hashing, configurable password policy and brute-force protection, with lockouts per address and per identifier stored in the database (they survive restarts).
- Two-factor authentication (TOTP) with backup codes, enforceable per user; each code is accepted only once.
- Captcha on sign-in and password reset: ALTCHA, Cloudflare Turnstile or Google reCAPTCHA.
- Sign-in always goes through the captcha, brute-force and two-factor checks: only the session and sign-out endpoints of the authentication library are exposed, and self sign-up is disabled.
- Role scopes enforced on every path to the data: schedule, recurring series, vehicles and resources, exports, statistics, files, REST API, MCP server and AI assistant.
- Session management, audit trail of every change with restore, and configurable retention.
- GDPR tools: privacy policy, cookie banner and data purge.

### Administration

- White-label branding: application name, logo, favicon and sign-in background for light and dark themes.
- Announcement banner, maintenance mode, working hours, date and time formats, time zone and default home page.
- Light and dark themes, and per-user preferences.
- Encrypted database backups with restore, and an importer for SoPlanning 1.56 and 1.57.
- REST API with API keys and built-in documentation.
- Version page that checks for new releases and shows their notes.
- Demo mode for public showcases (`DEMO_MODE=true`, or *Demo* in the installer): a French dataset with dates relative to the current day, regenerated every night and at each start, a shared demo account that cannot be changed, administration and outgoing messages turned off.

### Languages

- Interface, error messages, notifications, e-mails and exports in English, French, Spanish and German.
- Each user picks their language; the administrator sets the default language of the instance.
- E-mails and notifications are sent in each recipient's language.

### Installation and operations

- One-command installer for Ubuntu and Debian (amd64 and arm64) that sets up Docker, PostgreSQL 18, optional Caddy with automatic HTTPS (including the Cloudflare DNS challenge) and the administrator account.
- The application connects to PostgreSQL with a dedicated role that owns its database but is not a superuser.
- Behind the Cloudflare proxy, Caddy takes the visitor's address only from Cloudflare's own servers.
- `humble-planning` command to check the status, read the logs, back up, update and roll back.
- Updates with an automatic database backup and automatic rollback on failure, and optional nightly patch updates.
- Multi-architecture Docker images published on the GitHub Container Registry.

[1.4.0]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.4.0
[1.3.0]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.3.0
[1.2.3]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.2.3
[1.2.2]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.2.2
[1.2.1]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.2.1
[1.2.0]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.2.0
[1.1.3]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.1.3
[1.1.2]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.1.2
[1.1.1]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.1.1
[1.1.0]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.1.0
[1.0.1]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.0.1
[1.0.0]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.0.0
