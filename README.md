<p align="center">
  <a href="https://humbleplanning.com/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/branding/logo-dark.png">
      <img src="docs/branding/logo-light.png" alt="Humble Planning" width="360">
    </picture>
  </a>
</p>

<h3 align="center">Plan smarter, perform sustainably.</h3>

<p align="center">
  Open-source scheduling for field teams: people, vehicles and equipment on one real-time schedule,<br>
  with an AI assistant that works under your control.
</p>

<p align="center">
  <a href="https://humbleplanning.com/"><strong>Website</strong></a> ·
  <a href="https://demo.humbleplanning.app/"><strong>Live demo</strong></a> ·
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="docs/installation.md"><strong>Installation guide</strong></a> ·
  <a href="https://github.com/Malfhas/HumblePlanning-Android"><strong>Android app</strong></a> ·
  <a href="CHANGELOG.md"><strong>Changelog</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/Malfhas/HumblePlanning/releases/latest"><img src="https://img.shields.io/github/v/release/Malfhas/HumblePlanning?sort=semver&label=version&color=0f766e" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white" alt="Next.js 16">
  <img src="https://img.shields.io/badge/PostgreSQL-16%2B-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16+">
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker ready">
  <img src="https://img.shields.io/badge/MCP-40%20tools-6d28d9" alt="MCP server with 40 tools">
  <img src="https://img.shields.io/badge/languages-EN%20%C2%B7%20FR%20%C2%B7%20ES%20%C2%B7%20DE-0ea5e9" alt="English, French, Spanish, German">
</p>

<p align="center"><sub>A project by <a href="https://indumia.com/"><strong>Indumia</strong></a></sub></p>

---

<p align="center">
  <a href="#a-quick-tour">Tour</a> ·
  <a href="#why-humble-planning">Why</a> ·
  <a href="#features">Features</a> ·
  <a href="#ai-assistant-and-mcp-server">AI &amp; MCP</a> ·
  <a href="#live-demo">Demo</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#development">Development</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#license">License</a>
</p>

## A quick tour

[![The schedule: every person, project, vehicle and resource on one real-time grid](docs/screenshots/schedule.webp)](docs/screenshots/schedule.webp)

**The schedule.** Every team member on one grid, week after week: drag tasks to move them, stretch them to change their dates, see public holidays, multi-person assignments and recurring work at a glance. Everyone sees the same schedule, updated live.

[![The AI assistant answering an availability question next to the schedule](docs/screenshots/ai-assistant.webp)](docs/screenshots/ai-assistant.webp)

**The AI assistant.** Ask in plain language ("Is Antoine available in week 45?") and get an answer built from the live schedule: capacity, planned hours, holidays. It can also prepare changes, which are only applied once you approve them.

[![Claude checking a person's availability through the Humble Planning MCP server](docs/screenshots/mcp-claude.webp)](docs/screenshots/mcp-claude.webp)

**Or from the AI you already use.** Connect Claude, ChatGPT or any MCP client to Humble Planning as a custom connector. Here, Claude checks a person's availability for a whole week through the MCP server, with the user's own permissions, and even notices a public holiday that is missing from the schedule.

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/team-day.webp"><img src="docs/screenshots/team-day.webp" alt="Team/day view"></a>
      <p><strong>Team/day view.</strong> Who does what, hour by hour, for a whole team on a given day.</p>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/project-statistics.webp"><img src="docs/screenshots/project-statistics.webp" alt="Project statistics"></a>
      <p><strong>Project statistics.</strong> Consumed, upcoming and remaining hours for every project, against its budget.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/project-editor.webp"><img src="docs/screenshots/project-editor.webp" alt="Project editor with a satellite map"></a>
      <p><strong>Projects and worksites.</strong> Job numbers, groups, statuses, labour budgets and the site address on a satellite map.</p>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/schedule-details.webp"><img src="docs/screenshots/schedule-details.webp" alt="Person details on the schedule"></a>
      <p><strong>Details on hover.</strong> Job title, team, contact and qualifications without leaving the schedule.</p>
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="34%" valign="top">
      <a href="docs/screenshots/mobile.webp"><img src="docs/screenshots/mobile.webp" alt="Humble Planning on a phone"></a>
    </td>
    <td valign="top">
      <h3>On the phone, in the field</h3>
      <p>The whole application is responsive. On a phone, each person opens on their own week: today's tasks, public holidays and the days ahead. Schedules can also be subscribed to from any calendar app (iCal), so the week shows up next to personal appointments.</p>
      <p>Notifications follow the team wherever they are: in-app, e-mail, push, and SMS or WhatsApp if enabled.</p>
      <p>A native Android app is also available: <a href="https://github.com/Malfhas/HumblePlanning-Android">Humble Planning for Android</a>, with real-time alerts and the team grid, on the same server and permissions.</p>
      <p><sub>The screenshots show the interface in French and English. Humble Planning is available in English, French, Spanish and German: each user picks their language, and e-mails and exports follow it.</sub></p>
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="25%" valign="top">
      <a href="docs/screenshots/android-grid.webp"><img src="docs/screenshots/android-grid.webp" alt="The Android app: the team grid"></a>
    </td>
    <td width="25%" valign="top">
      <a href="docs/screenshots/android-task.webp"><img src="docs/screenshots/android-task.webp" alt="The Android app: a task"></a>
    </td>
    <td width="25%" valign="top">
      <a href="docs/screenshots/android-alerts.webp"><img src="docs/screenshots/android-alerts.webp" alt="The Android app: real-time alerts"></a>
    </td>
    <td width="25%" valign="top">
      <a href="docs/screenshots/android-assistant.webp"><img src="docs/screenshots/android-assistant.webp" alt="The Android app: the AI assistant"></a>
    </td>
  </tr>
</table>

<p align="center"><sub>The <a href="https://github.com/Malfhas/HumblePlanning-Android">Android app</a>: the team grid, a task, real-time alerts and the AI assistant. Sign in with a password or by scanning a QR code from your web profile.</sub></p>

## Why Humble Planning

- **As simple as a spreadsheet, far more powerful.** A grid everybody understands, with drag and drop, colours and filters, backed by a real database instead of a shared file.
- **Real time, for everyone.** Changes appear instantly on every screen, with live presence: no more outdated copies of the schedule.
- **Built for field operations.** Business units, teams, qualifications, labour types, contract types, vehicles, equipment and worksites with their addresses: the things construction, maintenance and service companies actually plan.
- **AI under control.** The assistant only sees what the user is allowed to see, never writes without explicit approval, and runs on the model you choose, with spending caps and privacy options.
- **Open and self-hosted.** Your server, your data, no licence fees. Install it with one command, brand it with your own logo and colours, extend it under the AGPL.
- **Secure by default.** Argon2id passwords, two-factor authentication, fine-grained roles and permissions, a full audit trail with restore, encrypted backups and GDPR tools.

## Features

| Area | Highlights |
| --- | --- |
| **Schedule** | Day and hour views; views by people, projects, vehicles and resources, plus a calendar (day, week and month, one person or everyone); drag and drop, resize and copy; multi-person tasks, recurring tasks, milestones, half days; public holidays; filters, sorting and zoom; live presence |
| **Tasks** | Task list with search and filters, statuses, notes, attachments, locking and change history |
| **People** | Users, teams, business units, qualifications, labour types, contract types (employee, temporary worker, subcontractor, apprentice, intern, freelancer), job titles, hourly rates |
| **Projects and worksites** | Job numbers, project groups, custom statuses and colours, site address on a map, labour budgets in hours and cost, archiving |
| **Logistics** | Vehicles and resources with their types, assignments and availability on the schedule |
| **Analytics** | User statistics (workload, occupancy, hours by labour type), project statistics (consumed, upcoming and remaining hours), ROI |
| **Exports and calendars** | PDF (schedule grid or list, calendar, with optional statistics pages), project Gantt in PDF and Excel, Excel and CSV exports; personal iCal feeds |
| **Notifications** | In-app notifications, e-mail (SMTP, Mailgun or Nuntly), weekly summary e-mails, push notifications, SMS and WhatsApp (Sent.dm) |
| **Android app** | [Native app](https://github.com/Malfhas/HumblePlanning-Android) for the same server: day, week and month views and the team grid, task creation and editing, real-time alerts, the AI assistant, your own tasks readable offline; sign-in by password, second factor or QR code, a role permission decides who may use it |
| **AI assistant** | Full-page chat and floating assistant, answers from live data, approval card before any change, model of your choice through OpenRouter, monthly quota per user, local voice dictation, PDF and image attachments |
| **MCP server** | 40 tools for Claude, ChatGPT, Copilot and any MCP client, OAuth 2.1 with a consent screen or API keys, the user's own permissions on every call |
| **Security** | Argon2id, TOTP two-factor authentication with backup codes, password policy, brute-force protection, captcha (ALTCHA, Cloudflare Turnstile, reCAPTCHA), session management, audit trail with restore |
| **Administration** | Roles and permissions with scopes, white-label branding (logo, favicon, sign-in background for light and dark themes), announcement banner, working hours, date and time formats, time zone, maintenance mode, module switches, system health (live status, configuration alerts, scheduled tasks, grouped incidents, failed deliveries), AI assistant history (usage and cost) and purge tools |
| **Data** | Encrypted backups and restore, import from SoPlanning 1.56 and 1.57, REST API with API keys and built-in documentation |
| **Languages** | English, French, Spanish and German, per user, with e-mails, notifications and exports in each recipient's language |

## AI assistant and MCP server

Humble Planning ships with two ways to work with AI, both bound to the signed-in user's permissions.

**The built-in assistant** answers questions about the schedule ("Who is free next Tuesday in the electrical team?", "How many hours are planned on job B00102 this month?") and can prepare changes: create, move, copy, update or delete a task, create a project. Nothing is written until the user approves the change in a confirmation card that spells it out. Administrators choose the models (DeepSeek, Mistral, Claude, GPT and more through [OpenRouter](https://openrouter.ai/)), can require providers that keep no data, and set a monthly spending cap per user. Voice dictation runs locally in the browser with Whisper.

To enable it: *Settings → AI → AI chat*, enter an OpenRouter API key (or set `OPENROUTER_API_KEY` in `.env`) and add a model. The assistant switches on by itself; access is then granted per role ("Use the AI assistant", "Allow changes by the AI assistant").

**The MCP server** lets external assistants work with the schedule. Add a custom connector with the URL `https://<your-domain>/api/mcp` in Claude, ChatGPT or any MCP client: the user signs in to Humble Planning and approves the connection (OAuth 2.1), or uses a personal API key. Write tools require a dedicated permission. Setup guides for each client are in *Settings → AI → MCP*. See it in action in the [tour](#a-quick-tour).

## Live demo

Try Humble Planning at **[demo.humbleplanning.app](https://demo.humbleplanning.app/)** with the shared demo account:

| Login | Password |
| --- | --- |
| `humbledemo` | `humblepass` |

The demo data is reset every night. Administration, e-mails, text messages and the AI assistant are turned off.

To run your own public demo, see [Demo instance](docs/installation.md#demo-instance).

## Quick start

Humble Planning runs with Docker. On a server running Ubuntu 22.04/24.04 LTS or Debian 12/13 (amd64 or arm64), run as root:

```bash
curl -fsSL https://raw.githubusercontent.com/Malfhas/HumblePlanning/main/install.sh | sudo bash
```

[![The installer: system checks, a few questions with sensible defaults, then a summary before anything is installed](docs/screenshots/installer.webp)](docs/screenshots/installer.webp)

The installer:

- installs Docker Engine and Docker Compose when needed;
- asks for the public URL, a short name and a label for the instance, the database (built-in PostgreSQL 18 or an existing server), and whether to serve it with Caddy for automatic HTTPS (Let's Encrypt, optionally through the Cloudflare DNS challenge);
- generates the secrets, applies the database migrations, creates the administrator account and starts the stack.

**Caddy, the reverse proxy.** Unless you already run your own, the installer puts [Caddy](https://caddyserver.com/), an open-source web server, in front of Humble Planning. Caddy:

- gets the HTTPS certificates and renews them by itself, from Let's Encrypt or through the Cloudflare DNS challenge;
- serves HTTP/2 and HTTP/3;
- compresses the responses (zstd and gzip);
- routes the real-time Socket.io traffic to the right container;
- adds the security headers;
- shows a maintenance page while an instance restarts.

Behind nginx, Apache or another reverse proxy instead, see [Behind an existing reverse proxy](docs/installation.md#behind-an-existing-reverse-proxy).

Several instances can run on one server, each with its own domain, database, files, backups and version, behind one shared Caddy: run `sudo humble-planning new` (or the installer again) to add another one.

Then manage the instances with the `humble-planning` command (the instance name can be left out while there is only one):

```bash
humble-planning list               # instances: name, label, URL, version, state
humble-planning new                # install another instance (installer of the latest release)
humble-planning status <instance>  # version, available update, state of the containers
humble-planning logs <instance>    # logs of the app, socket or db service
humble-planning update --all       # back up each database, update, roll back automatically on failure
humble-planning backup <instance>  # back up the database
humble-planning remove <instance>  # final backup, then remove the instance
humble-planning help               # every command
```

Non-interactive installation, several instances, the shared reverse proxy, updates and rollbacks, automatic updates, migrating from 1.0.x, running behind an existing reverse proxy and building the Docker images yourself are covered in the **[installation guide](docs/installation.md)**.

## Development

Requirements: Bun 1.4.4 or later, Node.js 24 or later (26 recommended, see `.nvmrc`) and PostgreSQL 16 or later.

```bash
bun install
cp .env.example .env     # set DATABASE_URL, BETTER_AUTH_URL, APP_BASE_URL and the secrets
bun run db:migrate
bun run db:seed          # system roles, default statuses and a development administrator (admin / admin)
bun run dev              # application on http://localhost:3000
bun run dev:socket       # real-time server (Socket.io), in a second terminal
```

Built with [Next.js](https://nextjs.org/) 16, React 19, TypeScript, [Bun](https://bun.sh/), PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/), [Better Auth](https://www.better-auth.com/), [Socket.io](https://socket.io/), Tailwind CSS 4, shadcn/ui and [next-intl](https://next-intl.dev/). The schedule grid is a custom canvas renderer.

## Contributing

Bug reports, ideas, translations and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) to set up the project and learn what is checked before a change is merged. Commits are signed off under the [Developer Certificate of Origin](DCO) (`git commit -s`): you keep the copyright of your contribution. Questions and ideas go to [Discussions](https://github.com/Malfhas/HumblePlanning/discussions). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

If Humble Planning is useful to you, you can support its development through [GitHub Sponsors](https://github.com/sponsors/Malfhas).

## Security

Please do not report security vulnerabilities in public issues. Use GitHub's [private vulnerability reporting](https://github.com/Malfhas/HumblePlanning/security/advisories/new) instead, as described in the [security policy](SECURITY.md).

## AI-assisted development

Humble Planning is developed with the help of AI coding assistants. They are tools in the hands of the maintainer: the product decisions, the architecture and the review of every change remain human, and all code goes through the same checks (type checking, automated tests, linting, translation checks) before it is merged. AI-assisted contributions are welcome under the same rules: see [CONTRIBUTING.md](CONTRIBUTING.md#ai-assisted-contributions).

## License

Humble Planning is free software, distributed under the **GNU Affero General Public License v3.0 or later** (`AGPL-3.0-or-later`). The full text is in the [LICENSE](LICENSE) file.

In short: you may use, study, modify and redistribute this software, including within a company. If you modify it and make it available to users over a network (for example as an online service), you must give them access to the source code of your modified version, under the same license.

## Credits

- Humble Planning is designed, built and maintained by **[Indumia](https://indumia.com/)**. Learn more at [humbleplanning.com](https://humbleplanning.com/).
- AI model icons come from [lobe-icons](https://github.com/lobehub/lobe-icons) (MIT, see `public/modeles/LICENCE.txt`).
- The installer serves the instances with [Caddy](https://caddyserver.com/) (Apache-2.0), in its own container image.
