# Contributing to Humble Planning

Thank you for your interest in Humble Planning! Bug reports, ideas, translations and code are all welcome. This guide explains how to get started and what we check before a change is merged.

By taking part in this project, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug**: open an [issue](https://github.com/Malfhas/HumblePlanning/issues/new/choose) with the bug report form. Please search existing issues first.
- **Suggest an idea**: open a feature request, or start a conversation in [Discussions](https://github.com/Malfhas/HumblePlanning/discussions) if the idea needs shaping.
- **Ask a question**: use [Discussions](https://github.com/Malfhas/HumblePlanning/discussions) rather than issues.
- **Translate**: the interface is available in English, French, Spanish and German. Improving a translation is a great first contribution (see [Translations](#translations)).
- **Write code**: pick an issue labelled `good first issue` or `help wanted`, or propose your own change.
- **Report a security vulnerability**: never in a public issue. Follow the [security policy](SECURITY.md).

For anything larger than a small fix, please open an issue or a discussion first, so that we can agree on the approach before you spend time on it.

## Development setup

Requirements: [Bun](https://bun.sh/) 1.4.4 or later, Node.js 24 or later (26 recommended, see `.nvmrc`), Docker (for the development database) and Git.

```bash
git clone https://github.com/<your-account>/HumblePlanning.git
cd HumblePlanning
bun install

docker compose up -d       # PostgreSQL 18 on localhost:5432 (user humble, password humble_dev)
cp .env.example .env       # then edit .env, see below

bun run db:migrate         # create the schema
bun run db:seed            # system roles, default statuses, settings and a development administrator (admin / admin)

bun run dev                # application on http://localhost:3000
bun run dev:socket         # real-time server (Socket.io), in a second terminal
```

In `.env`, set at least:

- `DATABASE_URL=postgresql://humble:humble_dev@localhost:5432/humble_planning`
- `BETTER_AUTH_URL` and `APP_BASE_URL` to `http://localhost:3000`
- `BETTER_AUTH_SECRET` and `SOCKET_SECRET` to random values (`openssl rand -hex 32`)

If the development server shows a blank page or keeps reloading after an abrupt stop, clear the Next.js cache with `bun run dev:clean`.

## Project conventions

- **Language**: code, comments, identifiers, log messages and test names are in English.
- **User-facing text** never lives in the code: every message is in `src/messages/<language>/<namespace>.json`, in **all four languages** (English, French, Spanish and German). If you cannot translate a message, copy the English text into the other catalogs and say so in your pull request.
- **Database**: the schema lives in `src/db/schema/`. After a change, generate a migration with `bun run db:generate` and commit it. Optional columns are nullable (no empty-string or zero defaults), and Zod validators must match the schema.
- **Security**: no secrets, credentials or personal data in the code, the tests or the fixtures. Permissions are checked on the server, never only in the interface.
- **Scope**: one topic per pull request. Unrelated refactoring, formatting or dependency changes make a review much harder.

## Checks before opening a pull request

The same checks run automatically on every pull request; running them locally saves a round trip:

```bash
bunx tsc --noEmit                  # type check
bun test                           # unit tests
bun run lint                       # ESLint (no errors allowed; fix the warnings in the code you touch)
bun run i18n:check --strict        # all four catalogs have the same messages
bun run i18n:scan --max 0          # no hard-coded user-facing text
```

If you change `install.sh`, `deploy/humble-planning` or `docker-entrypoint.sh`, also run `shellcheck -S warning` on them.

## Pull requests

1. Fork the repository and create a branch from `main` (for example `fix/task-drag-on-mobile` or `feat/export-ods`).
2. Make your change, with tests when it changes behaviour.
3. Sign off every commit (see [Developer Certificate of Origin](#developer-certificate-of-origin-dco)).
4. Open a pull request against `main` and fill in the template: what changes, why, how you tested it, and screenshots for interface changes.

Pull requests are squash-merged: the title of the pull request becomes the commit message on `main`, so make it a clear one-line summary. The maintainer may ask for changes, and keeps the final decision on what is merged.

`CHANGELOG.md` is updated by the maintainer when a release is prepared.

## Developer Certificate of Origin (DCO)

Humble Planning uses the [Developer Certificate of Origin](DCO) instead of a contributor license agreement. You keep the copyright of your contribution, which is distributed under the project license (AGPL-3.0-or-later). By signing off a commit, you certify that you wrote it or otherwise have the right to submit it under that license.

To sign off, add the `-s` flag when you commit:

```bash
git commit -s -m "Fix the week number on the planning header"
```

Git appends a line with the name and e-mail address of your Git configuration:

```
Signed-off-by: Jane Doe <jane.doe@example.com>
```

Use your real name or a consistent public identity, and an e-mail address you can be contacted at; anonymous contributions cannot be accepted. A check on each pull request verifies that every commit is signed off by its author. To fix a pull request after the fact:

```bash
git commit --amend -s --no-edit          # last commit only
git rebase --signoff main                # every commit of the branch
git push --force-with-lease
```

## AI-assisted contributions

AI coding assistants are welcome here: the maintainer uses them to develop Humble Planning too. The same rules apply to every contribution, however it was written: you remain responsible for what you submit, so make sure you understand every line, that it is tested and passes the checks, and that you have the right to submit it under the project license, as certified by your DCO sign-off. Mentioning the tools you used in the pull request is appreciated, not required.

## Translations

Translations live in `src/messages/<language>/`, one JSON file per area of the application. To improve a translation, edit the values (never the keys) and run `bun run i18n:check --strict`. `bun run i18n:check --untranslated` lists the messages that are still identical to English. To add a new language, follow the steps at the top of `src/i18n/config.ts`.

## License

By contributing, you agree that your contributions are licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).
