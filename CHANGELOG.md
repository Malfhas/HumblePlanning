# Changelog

All notable changes to Humble Planning are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/Malfhas/HumblePlanning/releases/tag/v1.0.0
