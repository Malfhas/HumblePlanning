# Security policy

## Supported versions

Security fixes are released for the latest minor version. Please keep your installation up to date: automatic updates (`humble-planning auto-update on`) install patch releases every night.

| Version | Supported |
| --- | --- |
| 1.0.x | ✅ |
| < 1.0 | ❌ |

## Reporting a vulnerability

**Please do not report security vulnerabilities in public issues, discussions or pull requests.**

Report them privately through GitHub: [Report a vulnerability](https://github.com/Malfhas/HumblePlanning/security/advisories/new) (*Security* tab → *Report a vulnerability*). If you cannot use GitHub, write to **contact@indumia.com** with `[security]` in the subject.

Please include:

- the affected version and how Humble Planning is installed (installer, manual Docker Compose, from source);
- a description of the vulnerability and its impact;
- the steps to reproduce it, or a proof of concept;
- any suggestion for a fix.

## What to expect

- An acknowledgement within 5 business days.
- An assessment of the report, and regular updates until it is resolved.
- A fix released as a new patch version. Its release title carries the `[security]` marker, so that administrators see a security update notice in *Settings → Version*.
- A published security advisory once the fix is available, crediting you unless you prefer to stay anonymous.

We ask you to give us a reasonable time to release a fix before any public disclosure, and at most 90 days from your report. Please do not access, modify or delete data that does not belong to you, and do not degrade the service of an instance you do not own (including the public demo).

## Scope

In scope: the application, the real-time server, the installer and management command (`install.sh`, `humble-planning`) and the published Docker images.

Out of scope: vulnerabilities that require a compromised server or administrator account, unsupported versions, issues caused by a configuration that the documentation advises against, and reports from automated scanners without a demonstrated impact.

## Hardening recommendations

- Serve Humble Planning over HTTPS only, behind the provided Caddy reverse proxy or your own.
- Make sure your reverse proxy overwrites the `X-Real-IP` header. Set `TRUSTED_PROXY=cloudflare` only when the server accepts traffic from Cloudflare alone.
- Enable two-factor authentication for administrators and keep the password policy strict.
- Keep backups encrypted and store the backup encryption key outside the server.
