# Installation guide

This guide covers installing, running and updating Humble Planning on your own server. For an overview of the project, see the [README](../README.md).

## Installing

Humble Planning runs with Docker. On a server running Ubuntu 22.04/24.04 LTS or Debian 12/13 (amd64 or arm64), run as root:

```bash
curl -fsSL https://raw.githubusercontent.com/Malfhas/HumblePlanning/main/install.sh | sudo bash
```

The installer:

- installs Docker Engine and Docker Compose from the official Docker repository when needed (any Linux distribution works if Docker 24+ and Compose 2.20+ are already installed);
- asks for the public URL, the installation directory (`/opt/humble-planning`), the instance type (production, or a public [demo instance](#demo-instance) reset every night), the database (built-in PostgreSQL 18 container, or an external PostgreSQL 16+ server), whether to install Caddy as a reverse proxy (automatic HTTPS with Let's Encrypt, optionally through the Cloudflare DNS challenge), whether the site is served through the Cloudflare proxy, and whether to enable automatic updates (off by default);
- generates `.env` with fresh secrets, sets up the [database user](#database-user) of the application, applies the database migrations, creates the administrator account (the password is typed twice and checked against the password policy) or, for a demo instance, loads the demo data, then starts the stack.

The installation directory contains `docker-compose.yml`, `.env` (mode 600) and the `Caddyfile`. Data is kept in Docker volumes (`db_data`, `uploads`, `data`, `caddy_data`). At the end, the installer displays the `BACKUP_ENCRYPTION_KEY` once: store it safely, backups cannot be restored without it.

## Managing the installation

```bash
humble-planning status                 # version, update status, state of the containers
humble-planning logs [service]         # app, socket, db or caddy
humble-planning start | stop | restart
humble-planning update                 # update to the latest release (see below)
humble-planning rollback               # go back to the previous version
humble-planning backup                 # back up the database into <install dir>/backups
humble-planning demo-reset [--force]   # demo instance: reload the demo data now (see below)
humble-planning auto-update on|off|status
humble-planning version | help
```

## Updating

```bash
sudo humble-planning update [--version X.Y.Z] [--yes]
```

The command reads the releases published on GitHub (`HUMBLE_UPDATE_REPO` in `.env`), compares them with the installed version (`HUMBLE_VERSION`), shows the release notes and asks for confirmation. Then it:

1. downloads the images of the new version (nothing is changed if this fails);
2. stops the application and backs up the database (`pg_dump`, custom format) into `<install dir>/backups/pre-update-<from>-to-<to>-<date>.dump` — the 5 most recent pre-update backups are kept, and the update stops if the backup fails;
3. applies the database migrations of the new version;
4. starts the new version and waits for its health check.

If step 3 or 4 fails, the previous version is started again and the database is restored from the backup taken in step 2; the command then explains what failed and where the backup is. `.env` only records the new version (`HUMBLE_VERSION`, previous one in `HUMBLE_PREVIOUS_VERSION`) once everything succeeded.

`sudo humble-planning rollback` goes back to `HUMBLE_PREVIOUS_VERSION` and offers to restore the pre-update backup (everything entered since the update is then lost); use `--yes --restore` or `--yes --no-restore` in scripts.

**Automatic updates** are disabled by default. `sudo humble-planning auto-update on` installs a nightly systemd timer (`humble-planning-update.timer`, random time between 02:00 and 05:00, or a cron entry in `/etc/cron.d` without systemd) running `humble-planning update --auto --yes`: only patch releases of the installed series are applied (1.3.x → 1.3.y), with the same backup and automatic rollback; minor and major releases are only reported in `/var/log/humble-planning-update.log`.

Running the installer again on an existing installation also works: it refreshes `docker-compose.yml` and the `humble-planning` command, keeps `.env`, the secrets and the volumes, then runs `humble-planning update`.

**Update notifications.** *Settings > Version* shows the installed and latest versions, the release notes and the command to run; administrators also get a notice in the sidebar. It only informs: updates are always installed with the command above. The server queries the public GitHub Releases API of `HUMBLE_UPDATE_REPO` at most once every 24 hours (or when *Check now* is clicked), with a plain GET request that carries no data about the instance; disable *Check for updates* in that tab to stop every outgoing request.

**Security releases (maintainers):** put `[security]` (case-insensitive) in the title or the body of a GitHub release that fixes a vulnerability; an instance older than that release then reports a *security update* instead of a regular one.

## Non-interactive installation

Set `HP_NONINTERACTIVE=1` and provide the answers as environment variables:

```bash
curl -fsSL https://raw.githubusercontent.com/Malfhas/HumblePlanning/main/install.sh | \
  sudo HP_NONINTERACTIVE=1 HP_URL=https://planning.example.com HP_CADDY=1 \
       HP_ACME_EMAIL=admin@example.com HP_ADMIN_USER=admin HP_ADMIN_PASSWORD='S3cure-Passw0rd' bash
```

| Variable | Default | Description |
| --- | --- | --- |
| `HP_URL` | — (required) | Public URL, e.g. `https://planning.example.com` |
| `HP_INSTALL_DIR` | `/opt/humble-planning` | Installation directory |
| `HP_INSTANCE` | `production` | `production` or `demo` (see [Demo instance](#demo-instance)) |
| `HP_DEMO_LOGIN`, `HP_DEMO_PASSWORD` | `demo`, `demo` | Demo account, public (shown on the sign-in page) |
| `HP_DEMO_RESET_TIME` | `03:00` | Daily reset time of the demo, `HH:MM` in the application time zone |
| `HP_DEMO_FORCE_RESET` | `0` | `1` lets the demo erase a database that holds data it did not create |
| `HP_DB_MODE` | `builtin` | `builtin` (PostgreSQL container) or `external` |
| `HP_DB_HOST`, `HP_DB_PORT` | —, `5432` | External server (`localhost` is mapped to the Docker host) |
| `HP_DB_NAME`, `HP_DB_USER` | `humble_planning`, `humbleplanning` | Database and application user, which owns the database and is not a superuser (see [Database user](#database-user)) |
| `HP_DB_PASSWORD` | — | External server password |
| `HP_DB_SSL` | `require` | `require` or `disable` |
| `HP_CADDY` | `1` for a domain name | `1` installs Caddy (ports 80/443), `0` publishes the app on 127.0.0.1 only |
| `HP_ACME_EMAIL` | — | Optional e-mail address for Let's Encrypt |
| `HP_CLOUDFLARE` | `0` | `1` uses the Cloudflare DNS challenge |
| `HP_CLOUDFLARE_API_TOKEN` | — | Cloudflare API token with `Zone.Zone:Read` and `Zone.DNS:Edit` |
| `HP_CLOUDFLARE_PROXY` | `0` | `1` when the site is served through the Cloudflare proxy: the visitor address is read from `CF-Connecting-IP` (see [Behind the Cloudflare proxy](#behind-the-cloudflare-proxy)) |
| `HP_ADMIN_USER` | `admin` | Administrator username |
| `HP_ADMIN_PASSWORD` | — (required) | Administrator password, checked against the password policy (not used by a demo instance) |
| `HP_AUTO_UPDATE` | `0` | `1` enables the nightly automatic updates (patch releases only) |
| `HP_VERSION` | latest release | Version to install, e.g. `1.2.3` |
| `HP_IMAGE`, `HP_CADDY_IMAGE` | `ghcr.io/malfhas/humble-planning[-caddy]` | Image repositories (the tag is the version) |
| `HP_UPDATE_REPO`, `HP_UPDATE_SOURCE` | `Malfhas/HumblePlanning`, — | GitHub repository of the releases / URL of a GitHub-style releases JSON (mirror, tests) |
| `HP_BUILD_SOURCE` | — | Git URL or directory: build the images on the server |
| `HP_IMAGE_ARCHIVE`, `HP_PULL` | —, `1` | Load a `docker save` archive / `0` never pulls (offline installation) |
| `HP_APP_PORT`, `HP_SOCKET_PORT` | `3000`, `3001` | Loopback ports of the app and of Socket.io |
| `HP_HTTP_PORT`, `HP_HTTPS_PORT` | `80`, `443` | Public ports of Caddy |
| `HP_TIMEZONE` | server time zone | Application time zone |
| `HP_ASSUME_YES`, `HP_UPDATE` | `0`, `1` | Skip the confirmations / update an existing installation |

`sudo bash install.sh --help` lists every variable.

## Demo instance

A demo instance is a public showcase: anyone can sign in and try Humble Planning. In demo mode:

- every night at `DEMO_RESET_TIME` (in the `TIMEZONE` time zone) and at each start of the application, **all the data is erased** and a demo dataset (in French) is generated, with dates relative to the current day;
- visitors sign in with a single demo account, recreated at each reset; its credentials are shown on the sign-in page and it cannot be modified;
- there is no administrator account: administration (settings, roles, backups, import, API keys, MCP, AI chat) is unavailable to everyone;
- e-mails, SMS, file uploads and update checks are disabled.

To install one, choose *Demo* at the *Instance type* question of the installer, or set `HP_INSTANCE=demo` (with `HP_DEMO_LOGIN`, `HP_DEMO_PASSWORD` and `HP_DEMO_RESET_TIME` if the defaults do not suit you) for a non-interactive installation. Use a dedicated server, or at least a dedicated database: the installer loads the demo data right after the migrations and, when the database already holds data that the demo did not create, only erases it once you confirm (or with `HP_DEMO_FORCE_RESET=1`). The installer never changes the type of an existing installation.

The settings live in `.env`:

| Key | Default | Description |
| --- | --- | --- |
| `DEMO_MODE` | — | `true` turns the instance into a demo |
| `DEMO_LOGIN`, `DEMO_PASSWORD` | `demo`, `demo` | Demo account, public |
| `DEMO_RESET_TIME` | `03:00` | Daily reset time, `HH:MM` |

`sudo humble-planning demo-reset` erases the data and loads the demo dataset immediately, then restarts the application; it refuses to run without `DEMO_MODE=true`. To turn an existing production instance into a demo, set `DEMO_MODE=true` in `.env`, then run `sudo humble-planning demo-reset --force`: `--force` is required because the database holds data that the demo did not create, and **all of it is erased** (take a `humble-planning backup` first if you may need it again).

## Behind an existing reverse proxy

Without Caddy, the application listens on `127.0.0.1:3000` and Socket.io on `127.0.0.1:3001`. Route `/socket.io/` to the socket server and everything else to the application, for example with nginx (the installer also writes this file as `nginx-example.conf`):

```nginx
server {
    listen 443 ssl http2;
    server_name planning.example.com;
    # ssl_certificate / ssl_certificate_key …

    client_max_body_size 500M;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
    }
}
```

The application reads the visitor address (rate limits, brute-force lockout, audit log) from `X-Real-IP`: your proxy must overwrite it with the address of the connection, as above. Behind the Cloudflare proxy, see below.

## Behind the Cloudflare proxy

With the Cloudflare proxy (orange cloud), visitors reach the server through Cloudflare, which sends their address in the `CF-Connecting-IP` header. Any client that reaches the server directly can send that header too, so it must only be believed on connections coming from [Cloudflare's IP ranges](https://www.cloudflare.com/ips/); otherwise a forged value would bypass the per-address limits of the sign-in page.

- **With Caddy** (answer *yes* to the Cloudflare proxy question, or `HP_CLOUDFLARE_PROXY=1`): Caddy reads `CF-Connecting-IP` only on connections from Cloudflare's ranges (`trusted_proxies` and `client_ip_headers` in the `Caddyfile`) and passes the result to the application in `X-Real-IP`; any other connection keeps its own address. The ranges are shipped with the Caddy image and updated with each release. `TRUSTED_PROXY` must stay unset in `.env`: the installer removes it.
- **With your own reverse proxy**: the installer sets `TRUSTED_PROXY=cloudflare` in `.env`, so that the application reads `CF-Connecting-IP`. The server must then only accept HTTP(S) traffic from Cloudflare's ranges (firewall), since the application cannot tell where a connection came from. Alternatively, let your proxy resolve the visitor address itself and remove `TRUSTED_PROXY`; with nginx, for example: `real_ip_header CF-Connecting-IP;` plus one `set_real_ip_from <range>;` per Cloudflare range, and keep `proxy_set_header X-Real-IP $remote_addr;`.

The installer never sets `TRUSTED_PROXY` without the Cloudflare proxy: the header is then ignored.

## Database user

The application never needs to be a PostgreSQL superuser, and must not be one: a superuser can run programs on the database server (`COPY … FROM PROGRAM`) and read its files, which would turn any SQL injection into a compromise of the server. It connects as the user of `DATABASE_URL`, which owns the application database and its `public` schema, is not a superuser, cannot create roles, and has the `CREATEDB` privilege for the in-app import (it restores the file into a temporary database before replacing the data).

**Built-in database.** The `postgres` superuser (`POSTGRES_USER` and `POSTGRES_PASSWORD` in `.env`) is only used inside the `db` container: the application containers never receive its password. The installer creates the application user (`humbleplanning` by default, password in `DATABASE_URL`) and checks its privileges and ownerships again at every run. For a superuser session: `cd /opt/humble-planning && sudo docker compose exec db psql -U postgres -d humble_planning`.

**External database.** Create the user and the database before running the installer, for example with `psql` as a superuser of your server:

```sql
CREATE ROLE humbleplanning LOGIN PASSWORD 'a-long-random-password' NOSUPERUSER NOCREATEROLE CREATEDB;
CREATE DATABASE humble_planning OWNER humbleplanning;
\connect humble_planning
ALTER SCHEMA public OWNER TO humbleplanning;
```

Owning the database lets the migrations create the tables and the restores (`humble-planning update` and `rollback`, in-app import) drop and recreate the `public` and `drizzle` schemas. Without `CREATEDB`, everything works except the in-app import. The installer tests the connection and warns when the user is a superuser or lacks `CREATEDB` (`provision check-db`).

## Docker images

The release workflow publishes multi-arch images (amd64, arm64) for every `v*` tag: `ghcr.io/malfhas/humble-planning` (Bun 1.4.4, PostgreSQL 18 client) and `ghcr.io/malfhas/humble-planning-caddy` (Caddy 2.11.7 with the [Cloudflare DNS module](https://github.com/caddy-dns/cloudflare) and the list of Cloudflare's IP ranges, `/etc/caddy/cloudflare-ips.caddy`). To build them yourself: `docker build -t humble-planning .` and `docker build -t humble-planning-caddy deploy/caddy`.
