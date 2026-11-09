# Installation guide

This guide covers installing, running and updating Humble Planning on your own server, with one or [several instances](#several-instances-on-one-server). For an overview of the project, see the [README](../README.md).

## Installing

Humble Planning runs with Docker. On a server running Ubuntu 22.04/24.04 LTS or Debian 12/13 (amd64 or arm64), run as root:

```bash
curl -fsSL https://raw.githubusercontent.com/Malfhas/HumblePlanning/main/install.sh | sudo bash
```

The installer:

- installs Docker Engine and Docker Compose from the official Docker repository when needed (any Linux distribution works if Docker 24+ and Compose 2.20+ are already installed);
- asks for the public URL, a short name and a label for the instance (see [Several instances](#several-instances-on-one-server)), the installation directory (`/opt/humble-planning/instances/<name>`), the instance type (production, or a public [demo instance](#demo-instance) reset every night), the database (built-in PostgreSQL 18 container, or an external PostgreSQL 16+ server), whether to serve it with Caddy, the [reverse proxy shared by the instances](#shared-reverse-proxy) (automatic HTTPS with Let's Encrypt, optionally through the Cloudflare DNS challenge), whether the site is served through the Cloudflare proxy, and whether to enable automatic updates (off by default);
- generates `.env` with fresh secrets, sets up the [database user](#database-user) of the application, applies the database migrations, creates the administrator account (the password is typed twice and checked against the password policy) or, for a demo instance, loads the demo data, then starts the stack.

The directory of the instance contains `docker-compose.yml`, `.env` (mode 600) and, with Caddy, `docker-compose.proxy.yml`. Data is kept in Docker volumes (`db_data`, `uploads`, `data`; the certificates in the `caddy_data` volume of the proxy). At the end, the installer displays the `BACKUP_ENCRYPTION_KEY` and the `CONFIG_ENCRYPTION_KEY` once: store both safely, in a password manager. Backups cannot be restored without the first one, and the passwords and API keys entered in Settings cannot be read without the second one (see [Secret settings](#secret-settings)).

Running the installer again lists the instances of the server and offers to update one of them or to install a new one; `sudo humble-planning new` installs a new one directly.

## Managing the instances

```bash
humble-planning list                              # instances: name, label, URL, version, state, Caddy
humble-planning new                               # install a new instance (see below)
humble-planning status [instance]                 # version, update status, state of the containers
humble-planning logs [instance] [service]         # app, socket or db (caddy: the shared proxy)
humble-planning start | stop | restart [instance]
humble-planning update [instance…|--all]          # update to the latest release (see below)
humble-planning rollback [instance]               # go back to the previous version
humble-planning backup [instance]                 # back up the database into <instance dir>/backups
humble-planning demo-reset [instance] [--force]   # demo instance: reload the demo data now (see below)
humble-planning auto-update on|off|status [instance]
humble-planning version [instance]
humble-planning set-url [instance] <url>          # change the public URL (see below)
humble-planning remove <instance>                 # remove an instance (see below)
humble-planning proxy status|logs|restart|reload  # the shared reverse proxy (Caddy)
humble-planning help
```

The instance name can be left out while only one instance is installed. With several, a command without a name shows the list and asks which one in a terminal; in a script (no terminal), it stops with the list and exit code 2. `remove` always needs the name.

## Updating

```bash
sudo humble-planning update [instance…|--all] [--version X.Y.Z] [--yes]
```

The command reads the releases published on GitHub (`HUMBLE_UPDATE_REPO` in `.env`), compares them with the installed version (`HUMBLE_VERSION`), shows the release notes and asks for confirmation. Then, for each instance, it:

1. downloads the images of the new version (nothing is changed if this fails);
2. stops the application and backs up the database (`pg_dump`, custom format) into `<install dir>/backups/pre-update-<from>-to-<to>-<date>.dump` — the 5 most recent pre-update backups are kept, and the update stops if the backup fails;
3. brings `.env` up to date (adds the settings the new version needs, such as `CONFIG_ENCRYPTION_KEY`, and removes those no version reads any more, such as `TRUST_PROXY_COMPRESSION`), then applies the database migrations of the new version;
4. starts the new version and waits for its health check.

If step 3 or 4 fails, the previous version is started again and the database is restored from the backup taken in step 2; the command then explains what failed and where the backup is. `.env` only records the new version (`HUMBLE_VERSION`, previous one in `HUMBLE_PREVIOUS_VERSION`) once everything succeeded. The log of each instance is `/var/log/humble-planning/<instance>.log`.

**Several instances.** `update --all`, several names (`update dupont martin`) or, in a terminal, the list shown by `update` without a name (current version → available version for each instance; answer with numbers or names separated by spaces, or `all`) update the instances one after the other, each with its own pre-update backup and automatic rollback: a failure on one instance does not stop or roll back the others. The [shared reverse proxy](#shared-reverse-proxy) then moves to the newest version installed, and a summary lists the result of each instance (updated, already up to date, rolled back, failed); the exit code is 1 when one of them failed.

`sudo humble-planning rollback [instance]` goes back to `HUMBLE_PREVIOUS_VERSION` and offers to restore the pre-update backup (everything entered since the update is then lost); use `--yes --restore` or `--yes --no-restore` in scripts. The shared proxy keeps its version.

**Automatic updates** are disabled by default. `sudo humble-planning auto-update on [instance]` installs a nightly systemd timer for the instance (`humble-planning-update@<instance>.timer`, random time between 02:00 and 05:00, or a cron entry `/etc/cron.d/humble-planning-update-<instance>` without systemd) running `humble-planning update <instance> --auto --yes`: only patch releases of the installed series are applied (1.3.x → 1.3.y), with the same backup and automatic rollback; minor and major releases are only reported in the log of the instance.

**The scripts follow the release.** Before touching any instance, `update` (also with `--auto`) installs the `humble-planning` command of the target release when it differs (the previous one is kept as `/usr/local/bin/humble-planning.prev`), then runs it again with the same arguments. Each updated instance gets the `docker-compose.yml` (and `docker-compose.proxy.yml`) of its new version, checked with `docker compose config` before use; the previous files are kept as `<file>.bak-<date>` and in `<instance dir>/backups/compose-v<previous version>/`, and the automatic rollback or `humble-planning rollback` puts them back with the previous image and database. When the shared proxy moves to the new version, its `docker-compose.yml` and `site-template.caddy` follow, with the same checks; the site files are not changed. The files come from the release tag on GitHub, from the source directory when the images are built from one (`HUMBLE_BUILD_SOURCE`), and are not fetched with `HUMBLE_PULL=0`. The command never moves to a release older than the newest version installed on the server (`update --version <older>` keeps it), and a download or check failure only shows a warning: the update goes on with the current command and files. A server installed with 1.1.1 or older gets this command by running the installer once.

Running the installer again on an existing instance also works: it refreshes `docker-compose.yml` and the `humble-planning` command, keeps `.env`, the secrets, the volumes and the site of the instance in the proxy, then runs `humble-planning update <instance>`. Running it twice in a row changes nothing.

**Update notifications.** *Settings > Version* shows the installed and latest versions, the release notes and the command to run; administrators also get a notice in the sidebar. It only informs: updates are always installed with the command above. The server queries the public GitHub Releases API of `HUMBLE_UPDATE_REPO` at most once every 24 hours (or when *Check now* is clicked), with a plain GET request that carries no data about the instance; disable *Check for updates* in that tab to stop every outgoing request.

**Security releases (maintainers):** put `[security]` (case-insensitive) in the title or the body of a GitHub release that fixes a vulnerability; an instance older than that release then reports a *security update* instead of a regular one.

## Several instances on one server

One server can run several Humble Planning instances, for example one per organisation, or a production instance next to a [demo](#demo-instance). Each instance has its own name, label, domain, database, files, backups and version, and is updated on its own.

**Adding an instance.** Run `sudo humble-planning new`, or the installer again: it lists the instances of the server (name, label, URL, version, state) and asks whether to update one of them or to install a new one. A new instance asks for the same settings as the first one, plus:

- a **short name**, used in the commands (`humble-planning status dupont`): 2 to 32 lowercase letters, digits or dashes, unique on the server; `proxy` and the words read by the command (`all`, `app`, `socket`, `db`, `caddy`, `on`, `off`, `enable`, `disable`, `status`) are reserved. The default comes from the domain (`dupont` for `dupont.example.com`);
- a **label**, free text shown in the lists (`Planning Dupont SARL`).

Its loopback ports are chosen automatically (the first free pair from `3000`/`3001`, then `3010`/`3011`…). In a script, set `HP_ACTION=new`, `HP_NAME` and `HP_LABEL` (see [Non-interactive installation](#non-interactive-installation)).

`sudo humble-planning new [--yes]` saves typing the `curl` command: it reads the same release list as `update` (no draft, no pre-release), downloads `install.sh` from the tag of the latest release (not from `main`, so that the installer, its files and the images match), checks it (not empty, a bash script, no syntax error), then runs it with `HP_ACTION=new`, without the update menu. It also works without any instance, for example after removing the last one. The `HP_*` variables of the environment reach the installer, for a non-interactive installation:

```bash
sudo HP_NONINTERACTIVE=1 HP_NAME=dupont HP_LABEL='Planning Dupont SARL' HP_URL=https://dupont.example.com \
     HP_CADDY=1 HP_ADMIN_PASSWORD='S3cure-Passw0rd' humble-planning new
```

By default, the new instance gets the version of that release, and the release list of the first instance (`HUMBLE_UPDATE_SOURCE` or `HUMBLE_UPDATE_REPO`, e.g. a mirror). Only one `new` runs at a time. When GitHub cannot be reached, the command stops and shows the `curl` command to use instead. The installer then installs the latest version of the `humble-planning` command.

**Memory.** Each instance runs its own web application, real-time server and PostgreSQL database: count about 1 GB of memory per instance. The installer reminds it, and warns when the server looks too small.

**Layout.**

| Path | Content |
| --- | --- |
| `/etc/humble-planning/instances/<name>.conf` | Registry: name, label, directory, Caddy settings of the site |
| `/opt/humble-planning/instances/<name>/` | `docker-compose.yml`, `docker-compose.proxy.yml` (with Caddy), `.env`, `backups/` |
| `/opt/humble-planning/proxy/` | The [shared reverse proxy](#shared-reverse-proxy) |
| `/var/log/humble-planning/<name>.log` | Log of the `humble-planning` commands for the instance (`proxy.log` for the proxy) |
| `/var/backups/humble-planning/` | Final backups of the [removed instances](#removing-an-instance) |

Each instance is a Docker Compose project named `humbleplanning-<name>` (`humbleplanning` for an installation [made with 1.0.x](#migrating-from-10x)), with its own volumes (`humbleplanning-<name>_db_data`, `_uploads`, `_data`) and private network. `HP_BASE_DIR` changes the root (`/opt/humble-planning`); `/etc/default/humble-planning` records it for the `humble-planning` command.

**Commands.** `humble-planning list` shows every instance with its label, URL, version, state and whether Caddy serves it. Every other command takes the instance name: `humble-planning status dupont`, `humble-planning logs dupont app`, `humble-planning backup dupont`… It can be left out while there is only one instance; with several, the command shows the list and asks which one in a terminal, and stops with exit code 2 in a script. `update` can take several names, or `--all` (see [Updating](#updating)).

## Shared reverse proxy

One Caddy container serves every instance that uses it, from the first installation on: the installer creates it with the first instance served by Caddy, and adds a site for each next one. It lives in `/opt/humble-planning/proxy` (Compose project `humbleplanning-proxy`):

| File | Content |
| --- | --- |
| `docker-compose.yml`, `.env` | The Caddy container: image, version, public ports (`HP_HTTP_PORT`, `HP_HTTPS_PORT`) |
| `caddy/Caddyfile` | Global options, generated: the Cloudflare trusted proxies when at least one site is behind the [Cloudflare proxy](#behind-the-cloudflare-proxy), then `import sites/*.caddy` |
| `caddy/sites/<name>.caddy` | The site of an instance (generated from `site-template.caddy`, then kept: your changes survive the updates) |
| `caddy/secrets/<name>.cloudflare-token` | Cloudflare API token of a site using the DNS challenge (mode 600); the instances never see it |

The instances reach the proxy through the Docker network `humbleplanning-proxy`, where their web app and Socket.io server are named `<name>-app` and `<name>-socket` (their database stays on the private network of the instance). Each site keeps its own Let's Encrypt e-mail address (`tls <e-mail>`) and DNS challenge settings. The certificates are in the `humbleplanning-proxy_caddy_data` volume.

Every change (a site added or removed, `proxy reload`) is checked with `caddy validate` before a hot reload, without interrupting the other sites; when the check or the reload fails, the previous files are restored and Caddy keeps its running configuration. The proxy image (`ghcr.io/malfhas/humble-planning-caddy`) follows the newest version installed on the server: when an instance moves to a newer version, the proxy is checked with the new image, then recreated (a few seconds), and started again with its previous version on failure. It never moves back when an instance is rolled back.

```bash
humble-planning proxy status    # image, ports, sites, container
humble-planning proxy logs      # Caddy logs (certificates, errors)
humble-planning proxy reload    # apply a change made in caddy/sites/ (checked first)
humble-planning proxy restart   # restart the container (all sites are briefly unavailable)
```

**Maintenance page.** While the application of an instance does not answer (an update stops it for the backup and the migrations, a restart, a crash), the proxy shows a maintenance page (status 503, `Retry-After`, not cached) instead of an error: it is shipped with the Caddy image, translated, self-contained, and reloads itself once the application answers again. Only pages get it: API, real-time (Socket.io) and other requests get a bare `503` without HTML. Each site imports it with `import /etc/caddy/humble-maintenance*.caddy`; the sites made by 1.1.0 get this line, and nothing else, when the proxy moves to 1.1.1 or when its configuration is applied again (`humble-planning proxy reload`). To do without the page for a site, comment the line out: it is then left as it is.

An instance can still do without Caddy (answer *no*, or `HP_CADDY=0`): it is then served by your own reverse proxy, see [Behind an existing reverse proxy](#behind-an-existing-reverse-proxy).

## Changing the URL of an instance

The public URL of an instance lives in its `.env` (`APP_BASE_URL`, `BETTER_AUTH_URL`): the sign-in, the protection against cross-site requests, the real-time connection and the MCP connections all depend on it, so it is not editable in *Settings*. Change it on the server:

```bash
sudo humble-planning set-url [instance] https://planning.example.org
sudo humble-planning set-url dupont https://planning.example.org --yes   # in a script
```

Point the DNS record of the new domain to the server first. Before changing anything, the command checks the URL (same rules as the installer: `http` or `https`, a host, an optional port, no path), refuses the current URL or a domain already used by another instance, and, with the shared proxy, refuses a port in the URL and an `https` URL on a name that cannot get a public certificate. For a site using the Cloudflare DNS challenge, it checks through the Cloudflare API that the token covers the zone of the new domain; give a new one with `--token-stdin` (`printf '%s\n' "$TOKEN" | sudo humble-planning set-url dupont https://… --token-stdin`).

It then shows the old and new URLs and what will change, and asks for confirmation (`--yes` in a script). Switching between `http` and `https` signs everyone out (the session cookies change), and MCP clients and OAuth connections must reconnect. Then it:

1. writes the new URL in `.env`, and the HTTPS mode of the site in the registry;
2. with the shared proxy: generates the site of the instance again for the new domain, after saving the current file as `caddy/sites/<name>.caddy.bak-<date>` (and warns when it was changed by hand: carry your changes over), checks the configuration and reloads Caddy without interrupting the other sites; without it: updates `server_name` in `nginx-example.conf` and reminds you to update your own reverse proxy;
3. recreates the app and socket containers so that they read the new URL, then checks the application (and the site through the proxy).

If a step fails, `.env`, the registry and the proxy site are restored, the proxy is reloaded and the instance is started again on its previous URL; the command then exits with an error and the path of its log.

## Secret settings

The passwords and API keys entered in *Settings* (SMTP password, Mailgun, Nuntly and Sent.dm keys, captcha secret key, OpenRouter key) are encrypted in the database with `CONFIG_ENCRYPTION_KEY`, a key of the `.env` of the instance (AES-256-GCM). A copy of the database alone (a dump, a backup of the `humble-planning` command, a copy of the volume, a database hosted elsewhere) no longer gives them away. It does not protect against someone who controls the server: the key sits in its `.env`. A value set in `.env` itself still takes precedence over the one entered in *Settings*, and is never stored in the database.

- **New installations** get the key from the installer, which displays it once at the end.
- **Existing instances** get it with the update to 1.2.0: `humble-planning update` adds `CONFIG_ENCRYPTION_KEY` to the `.env` of the instance when it is missing (an existing value is never changed), after the pre-update backup and before the migrations, so the values already stored are encrypted at the start of the new version. The command then says where the key is, without printing it: store it in a password manager. Running the installer again adds it too. The dumps taken before that (the pre-update backup included) still hold the secrets in plain text: delete them once they are no longer needed, or change those passwords and keys if a dump may have leaked.
- **Without the key** (an installation made by hand, without the installer), the application keeps working: the secrets stay in plain text, *Settings* shows a warning in each section that holds one, and each start logs how many are concerned. Add the key (`openssl rand -hex 32`) to `.env` and start the application again to encrypt them.
- **Rolling back** to a version older than 1.2.0 with `humble-planning rollback`: when the pre-update backup is restored, the secrets come back in plain text with it; otherwise the command decrypts them first, so that the older version can read them, and the next update encrypts them again. If one of them cannot be decrypted with the keys of `.env`, nothing is changed and the rollback is cancelled: put back the key it was encrypted with (as `CONFIG_ENCRYPTION_KEY` or `CONFIG_ENCRYPTION_KEY_PREVIOUS`), enter it again in *Settings*, or roll back with `--restore`.
- **Restoring on another server** needs the dump and the two keys of the `.env`, `BACKUP_ENCRYPTION_KEY` and `CONFIG_ENCRYPTION_KEY` (`humble-planning remove` keeps a copy of the `.env` next to its final dump). Without the second one, everything else works, and *Settings* lists the secrets to enter again.
- **A lost or changed key** never stops the application: the secrets it cannot read behave as if they had never been entered (no e-mail, no AI chat…), and *Settings* lists them with an *Enter again* badge. Putting the right key back makes them readable again; entering a new value replaces them.
- **An invalid key** (the placeholder of `.env.example`, or a value too short: 64 hexadecimal characters are expected) is treated as no key, with its own warning.

To change the key:

1. in `.env`, set `CONFIG_ENCRYPTION_KEY_PREVIOUS=<current key>` and `CONFIG_ENCRYPTION_KEY=<new key>` (`openssl rand -hex 32`);
2. apply it with `sudo humble-planning start <instance>`, which recreates the containers with the new `.env` (`restart` does not read `.env` again): the log of the start shows `Encrypted N secret setting(s) in the database.`;
3. remove `CONFIG_ENCRYPTION_KEY_PREVIOUS` from `.env`, then run `sudo humble-planning start <instance>` again.

## Removing an instance

```bash
sudo humble-planning remove <instance>
sudo humble-planning remove <instance> --yes --confirm <instance>   # in a script
```

The command shows what will be deleted and asks to type the name of the instance (in a script: `--yes --confirm <instance>`). Then it:

1. backs up the database one last time into `/var/backups/humble-planning/<name>-final-v<version>-<date>.dump`, next to a copy of its `.env` (the secrets needed to restore it elsewhere), and prints both paths; nothing is removed if this backup fails (`--no-backup` skips it);
2. removes its site and Cloudflare token from the shared proxy, then reloads it (nothing else is removed if Caddy refuses the new configuration);
3. removes its containers, volumes and network (an external database is left untouched on its server);
4. disables its automatic updates, removes its files (settings, Compose files, backups), then its directory once empty (anything else in it is kept, such as the other instances and the proxy next to an installation made with 1.0.x in `/opt/humble-planning`), and its registry entry;
5. when no other instance uses the shared proxy, offers to stop and remove it too, with its network and certificates (`--remove-proxy` or `--keep-proxy` in a script; kept by default).

A summary lists what was removed.

## Migrating from 1.0.x

An installation made with Humble Planning 1.0.x (in `/opt/humble-planning`, Compose project `humbleplanning`, an optional `caddy` service in the same Compose file, one nightly timer `humble-planning-update`) is taken over by the installer: run it once, as for an update.

```bash
curl -fsSL https://raw.githubusercontent.com/Malfhas/HumblePlanning/main/install.sh | sudo bash
```

- It is registered as an instance: the installer asks for a name and a label (defaults: from the domain; `HP_NAME` and `HP_LABEL` in a script). Nothing is moved or renamed: the directory, the Compose project `humbleplanning` and its volumes (database, files) stay where they are.
- Its Caddy moves into the shared proxy: the site is generated from its settings (domain, Let's Encrypt e-mail, Cloudflare DNS challenge and proxy), its Cloudflare token goes to the proxy, and the content of its `caddy_data` volume (certificates, ACME account) is copied into the proxy, which serves the site with the same certificates. The old Caddy container is stopped for a few seconds, then removed once the proxy serves the site; its volumes and its `Caddyfile` are kept (reference for custom changes, to carry over to `caddy/sites/<name>.caddy`).
- If a step fails, the proxy is stopped, its files restored and the old Caddy started again: the site stays served as before. Run the installer again once the cause is fixed: the takeover resumes.
- Its nightly update timer (or cron entry) becomes the one of the instance; the command, the registry and `/etc/default/humble-planning` are updated. Then the installer runs `humble-planning update` as usual.

`humble-planning update` of a 1.0.x installation still updates the application in place (images and database), but keeps the 1.0.x command and layout: the installer is what brings multi-instance support. The new `humble-planning` command refuses to manage a 1.0.x installation that was not taken over yet, and tells to run the installer. Once taken over, run the installer again to add another instance.

## Non-interactive installation

Set `HP_NONINTERACTIVE=1` and provide the answers as environment variables:

```bash
curl -fsSL https://raw.githubusercontent.com/Malfhas/HumblePlanning/main/install.sh | \
  sudo HP_NONINTERACTIVE=1 HP_URL=https://planning.example.com HP_CADDY=1 \
       HP_ACME_EMAIL=admin@example.com HP_ADMIN_USER=admin HP_ADMIN_PASSWORD='S3cure-Passw0rd' bash
```

On a server that already has instances, add `HP_ACTION=new` (with `HP_NAME` and `HP_LABEL`) to install another one, or `HP_NAME=<instance>` to update that one (`HP_ACTION=update` is the default when an instance exists).

| Variable | Default | Description |
| --- | --- | --- |
| `HP_ACTION` | `update` when an instance exists, else `new` | `new` installs another instance, `update` updates the instance `HP_NAME` |
| `HP_NAME` | from the domain (`planning` for `planning.example.com`) | Short name of the instance: 2 to 32 lowercase letters, digits or dashes; with `HP_ACTION=update`, the instance to update (required when there are several) |
| `HP_LABEL` | the domain | Label of a new instance, free text (e.g. `Planning Dupont SARL`) |
| `HP_URL` | — (required) | Public URL, e.g. `https://planning.example.com` |
| `HP_BASE_DIR` | `/opt/humble-planning` | Root of the instances and of the shared proxy |
| `HP_INSTALL_DIR` | `<base dir>/instances/<name>` | Directory of a new instance (new or empty) |
| `HP_INSTANCE` | `production` | Type of the instance: `production` or `demo` (see [Demo instance](#demo-instance)) |
| `HP_DEMO_LOGIN`, `HP_DEMO_PASSWORD` | `demo`, `demo` | Demo account, public (shown on the sign-in page) |
| `HP_DEMO_RESET_TIME` | `03:00` | Daily reset time of the demo, `HH:MM` in the application time zone |
| `HP_DEMO_FORCE_RESET` | `0` | `1` lets the demo erase a database that holds data it did not create |
| `HP_DB_MODE` | `builtin` | `builtin` (PostgreSQL container) or `external` |
| `HP_DB_HOST`, `HP_DB_PORT` | —, `5432` | External server (`localhost` is mapped to the Docker host) |
| `HP_DB_NAME`, `HP_DB_USER` | `humble_planning`, `humbleplanning` | Database and application user, which owns the database and is not a superuser (see [Database user](#database-user)) |
| `HP_DB_PASSWORD` | — | External server password |
| `HP_DB_SSL` | `require` | `require` or `disable` |
| `HP_CADDY` | `1` for a domain name | `1` serves the instance with the [shared Caddy](#shared-reverse-proxy) (ports 80/443), `0` publishes the app on 127.0.0.1 only |
| `HP_ACME_EMAIL` | — | Optional e-mail address for Let's Encrypt (this site) |
| `HP_CLOUDFLARE` | `0` | `1` uses the Cloudflare DNS challenge |
| `HP_CLOUDFLARE_API_TOKEN` | — | Cloudflare API token of this site, with `Zone.Zone:Read` and `Zone.DNS:Edit` (kept by the proxy only) |
| `HP_CLOUDFLARE_PROXY` | `0` | `1` when the site is served through the Cloudflare proxy: the visitor address is read from `CF-Connecting-IP` (see [Behind the Cloudflare proxy](#behind-the-cloudflare-proxy)) |
| `HP_ADMIN_USER` | `admin` | Administrator username |
| `HP_ADMIN_PASSWORD` | — (required) | Administrator password, checked against the password policy (not used by a demo instance) |
| `HP_AUTO_UPDATE` | `0` | `1` enables the nightly automatic updates (patch releases only) |
| `HP_VERSION` | latest release | Version to install, e.g. `1.2.3` |
| `HP_IMAGE`, `HP_CADDY_IMAGE` | `ghcr.io/malfhas/humble-planning[-caddy]` | Image repositories (the tag is the version) |
| `HP_UPDATE_REPO`, `HP_UPDATE_SOURCE` | `Malfhas/HumblePlanning`, — | GitHub repository of the releases / URL of a GitHub-style releases JSON (mirror, tests) |
| `HP_BUILD_SOURCE` | — | Git URL or directory: build the images on the server |
| `HP_IMAGE_ARCHIVE`, `HP_PULL` | —, `1` | Load a `docker save` archive / `0` never pulls (offline installation) |
| `HP_APP_PORT`, `HP_SOCKET_PORT` | first free pair from `3000`, `3001` (then `3010`, `3011`…) | Loopback ports of the app and of Socket.io |
| `HP_HTTP_PORT`, `HP_HTTPS_PORT` | `80`, `443` | Public ports of the shared Caddy, set when it is created |
| `HP_TIMEZONE` | server time zone | Application time zone |
| `HP_ASSUME_YES`, `HP_UPDATE` | `0`, `1` | Skip the confirmations / update an existing instance without asking (`0` stops instead) |

`sudo bash install.sh --help` lists every variable.

## Demo instance

A demo instance is a public showcase: anyone can sign in and try Humble Planning. In demo mode:

- every night at `DEMO_RESET_TIME` (in the `TIMEZONE` time zone) and at each start of the application, **all the data is erased** and a demo dataset (in French) is generated, with dates relative to the current day;
- visitors sign in with a single demo account, recreated at each reset; its credentials are shown on the sign-in page and it cannot be modified;
- there is no administrator account: administration (settings, roles, backups, import, API keys, MCP, AI chat) is unavailable to everyone;
- e-mails, SMS, file uploads and update checks are disabled;
- the [Android app](https://github.com/Malfhas/HumblePlanning-Android) can be tried with the demo account (password or QR code): real-time alerts work, push notifications are never sent, and a visitor cannot sign the other visitors' phones out.

To install one, choose *Demo* at the *Instance type* question of the installer, or set `HP_INSTANCE=demo` (with `HP_DEMO_LOGIN`, `HP_DEMO_PASSWORD` and `HP_DEMO_RESET_TIME` if the defaults do not suit you) for a non-interactive installation. A demo can share a server with production instances: each instance has its own database. Use a dedicated instance, or at least a dedicated database: the installer loads the demo data right after the migrations and, when the database already holds data that the demo did not create, only erases it once you confirm (or with `HP_DEMO_FORCE_RESET=1`). The installer never changes the type of an existing installation.

The settings live in `.env`:

| Key | Default | Description |
| --- | --- | --- |
| `DEMO_MODE` | — | `true` turns the instance into a demo |
| `DEMO_LOGIN`, `DEMO_PASSWORD` | `demo`, `demo` | Demo account, public |
| `DEMO_RESET_TIME` | `03:00` | Daily reset time, `HH:MM` |

`sudo humble-planning demo-reset [instance]` erases the data and loads the demo dataset immediately, then restarts the application; it refuses to run without `DEMO_MODE=true`. To turn an existing production instance into a demo, set `DEMO_MODE=true` in its `.env`, then run `sudo humble-planning demo-reset <instance> --force`: `--force` is required because the database holds data that the demo did not create, and **all of it is erased** (take a `humble-planning backup` first if you may need it again).

## Behind an existing reverse proxy

Without Caddy, the application listens on `127.0.0.1:3000` and Socket.io on `127.0.0.1:3001` (the next instances on `3010`/`3011`, `3020`/`3021`…: `HP_APP_PORT` and `HP_SOCKET_PORT` in the `.env` of the instance, shown by `humble-planning status`). Route `/socket.io/` to the socket server and everything else to the application, for example with nginx (the installer also writes this file, with the ports of the instance, as `nginx-example.conf` in its directory):

```nginx
server {
    listen 443 ssl http2;
    server_name planning.example.com;
    # ssl_certificate / ssl_certificate_key …

    client_max_body_size 500M;

    # The application sends raw JSON (several MB for a long planning range)
    gzip on;
    gzip_proxied any;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types application/json text/plain text/css application/javascript image/svg+xml;

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

Your proxy also compresses the responses: the API sends raw JSON, which reaches several MB for a long planning range (about 10 times less once compressed). With nginx, that is the `gzip` lines above. With Apache, enable `mod_deflate` and add `AddOutputFilterByType DEFLATE application/json text/html text/css application/javascript` to the site.

## Behind the Cloudflare proxy

With the Cloudflare proxy (orange cloud), visitors reach the server through Cloudflare, which sends their address in the `CF-Connecting-IP` header. Any client that reaches the server directly can send that header too, so it must only be believed on connections coming from [Cloudflare's IP ranges](https://www.cloudflare.com/ips/); otherwise a forged value would bypass the per-address limits of the sign-in page.

- **With Caddy** (answer *yes* to the Cloudflare proxy question, or `HP_CLOUDFLARE_PROXY=1`): Caddy reads `CF-Connecting-IP` only on connections from Cloudflare's ranges (`trusted_proxies` and `client_ip_headers` in the global options of the main `Caddyfile` of the [shared proxy](#shared-reverse-proxy), present as soon as one site is behind the Cloudflare proxy) and passes the result to the application in `X-Real-IP`; any other connection keeps its own address, so the sites that do not use Cloudflare are not affected. The ranges are shipped with the Caddy image and updated with each release. `TRUSTED_PROXY` must stay unset in `.env`: the installer removes it.
- **With your own reverse proxy**: the installer sets `TRUSTED_PROXY=cloudflare` in `.env`, so that the application reads `CF-Connecting-IP`. The server must then only accept HTTP(S) traffic from Cloudflare's ranges (firewall), since the application cannot tell where a connection came from. Alternatively, let your proxy resolve the visitor address itself and remove `TRUSTED_PROXY`; with nginx, for example: `real_ip_header CF-Connecting-IP;` plus one `set_real_ip_from <range>;` per Cloudflare range, and keep `proxy_set_header X-Real-IP $remote_addr;`.

The installer never sets `TRUSTED_PROXY` without the Cloudflare proxy: the header is then ignored.

## Database user

The application never needs to be a PostgreSQL superuser, and must not be one: a superuser can run programs on the database server (`COPY … FROM PROGRAM`) and read its files, which would turn any SQL injection into a compromise of the server. It connects as the user of `DATABASE_URL`, which owns the application database and its `public` schema, is not a superuser, cannot create roles, and has the `CREATEDB` privilege for the in-app import (it restores the file into a temporary database before replacing the data).

**Built-in database.** The `postgres` superuser (`POSTGRES_USER` and `POSTGRES_PASSWORD` in `.env`) is only used inside the `db` container: the application containers never receive its password. The installer creates the application user (`humbleplanning` by default, password in `DATABASE_URL`) and checks its privileges and ownerships again at every run. For a superuser session, from the directory of the instance: `cd /opt/humble-planning/instances/<name> && sudo docker compose exec db psql -U postgres -d humble_planning`.

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
