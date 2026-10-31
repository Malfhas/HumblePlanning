#!/usr/bin/env bash
#
# Humble Planning — installer (Docker)
# ====================================
#
# Installs or updates Humble Planning on a Linux server, with Docker:
#   - Docker Engine + Docker Compose, if missing (Ubuntu 22.04/24.04, Debian 12/13);
#     any distribution works when Docker 24+ and Compose 2.20+ are already installed
#   - the application containers: web app, Socket.io server, PostgreSQL 18
#   - optionally Caddy, a reverse proxy with automatic HTTPS (Let's Encrypt)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Malfhas/HumblePlanning/main/install.sh | sudo bash
#   sudo bash install.sh [--yes] [--non-interactive] [--help]
#
# Running it again on an existing installation updates it (new images, database
# migrations, restart). The .env file and the data volumes are always kept.
#
# Non-interactive mode — HP_NONINTERACTIVE=1, every answer comes from a variable
# (in interactive mode, these variables become the proposed defaults):
#   HP_URL                   public URL, e.g. https://planning.example.com (required)
#   HP_INSTALL_DIR           installation directory            (/opt/humble-planning)
#   HP_INSTANCE              production | demo                 (production)
#   HP_DEMO_LOGIN            demo account username             (demo)
#   HP_DEMO_PASSWORD         demo account password, public     (demo)
#   HP_DEMO_RESET_TIME       daily demo reset time, HH:MM      (03:00)
#   HP_DEMO_FORCE_RESET      1 = let the demo erase a database holding other data (0)
#   HP_DB_MODE               builtin | external                (builtin)
#   HP_DB_HOST, HP_DB_PORT   external server                   (-, 5432)
#   HP_DB_NAME, HP_DB_USER   database and application user     (humble_planning, humbleplanning)
#                            the user owns the database and is not a superuser; with the
#                            built-in database, the installer creates it (the superuser,
#                            POSTGRES_USER=postgres, never leaves the db container)
#   HP_DB_PASSWORD           external server password
#   HP_DB_SSL                require | disable                 (require, disable for local hosts)
#   HP_CADDY                 1 = install Caddy, 0 = no reverse proxy (1 for a domain name)
#   HP_ACME_EMAIL            optional e-mail address for Let's Encrypt
#   HP_CLOUDFLARE            1 = DNS challenge through Cloudflare (0)
#   HP_CLOUDFLARE_API_TOKEN  Cloudflare API token (Zone.Zone:Read + Zone.DNS:Edit)
#   HP_CLOUDFLARE_PROXY      1 = the site is served through the Cloudflare proxy (0): Caddy
#                            reads CF-Connecting-IP from Cloudflare's addresses only; without
#                            Caddy, TRUSTED_PROXY=cloudflare is set in .env
#   HP_ADMIN_USER            administrator username             (admin)
#   HP_ADMIN_PASSWORD        administrator password (required for a new production installation)
#   HP_AUTO_UPDATE           1 = nightly automatic updates, patch releases only (0)
#   HP_UPDATE                1 = update an existing installation without asking (1)
#   HP_ASSUME_YES            1 = answer "yes" to the confirmations
# Images and sources:
#   HP_VERSION               version to install, e.g. 1.2.3     (latest release)
#   HP_IMAGE                 application image repository       (ghcr.io/malfhas/humble-planning)
#   HP_CADDY_IMAGE           Caddy image repository             (ghcr.io/malfhas/humble-planning-caddy)
#   HP_PULL                  0 = never pull, use local images   (1)
#   HP_UPDATE_REPO           GitHub repository of the releases  (Malfhas/HumblePlanning)
#   HP_UPDATE_SOURCE         URL of a GitHub-style releases JSON (tests, mirrors)
#   HP_IMAGE_ARCHIVE         `docker save` archive to load first (offline installation)
#   HP_BUILD_SOURCE          git URL or directory: build the images on this server
#   HP_SOURCE_DIR            local checkout providing deploy/ (default: next to this script)
#   HP_REPO_RAW              raw URL of the repository for deploy/ files
#                            (https://raw.githubusercontent.com/Malfhas/HumblePlanning/main)
# Ports and misc:
#   HP_APP_PORT, HP_SOCKET_PORT   loopback ports of the app and Socket.io (3000, 3001)
#   HP_HTTP_PORT, HP_HTTPS_PORT   public ports of Caddy                   (80, 443)
#   HP_TIMEZONE              application time zone (server time zone, else Europe/Paris)
#   HP_FORCE_OS              1 = try to install Docker on an unsupported Debian/Ubuntu derivative
#   HP_LOG                   log file      (/var/log/humble-planning-install.log)
#   NO_COLOR                 disable colours

set -Eeuo pipefail
umask 022

# ─── Settings ────────────────────────────────────────────────────────────────

readonly DEFAULT_REPO_RAW="https://raw.githubusercontent.com/Malfhas/HumblePlanning/main"
readonly DEFAULT_IMAGE_REPO="ghcr.io/malfhas/humble-planning"
readonly DEFAULT_CADDY_IMAGE_REPO="ghcr.io/malfhas/humble-planning-caddy"
readonly PROJECT_NAME="humbleplanning"
readonly WRAPPER_PATH="/usr/local/bin/humble-planning"
readonly WRAPPER_CONFIG="/etc/default/humble-planning"
readonly DEFAULT_UPDATE_REPO="Malfhas/HumblePlanning"
readonly MIN_DOCKER="24.0"
readonly MIN_COMPOSE="2.20"
readonly USERNAME_PATTERN='^[A-Za-z0-9][A-Za-z0-9._@-]{1,99}$'
readonly TOTAL_STEPS=8

LOG_FILE="${HP_LOG:-/var/log/humble-planning-install.log}"
INTERACTIVE=1
ASSUME_YES="${HP_ASSUME_YES:-0}"
STEP=0
SPINNER_PID=""
STTY_SAVED=""
TMP_DIR=""

if locale -a 2>/dev/null | grep -qiE '^c\.utf-?8$'; then
  export LC_ALL=C.UTF-8
fi
export DEBIAN_FRONTEND=noninteractive

# ─── Terminal and colours ────────────────────────────────────────────────────

IS_TTY=0
[ -t 1 ] && IS_TTY=1
COLOR_MODE=none
if [ -z "${NO_COLOR:-}" ] && [ "$IS_TTY" = 1 ] && [ "${TERM:-dumb}" != "dumb" ]; then
  case "${COLORTERM:-}" in
    truecolor|24bit) COLOR_MODE=truecolor ;;
    *)
      if [[ "${TERM:-}" == *256color* ]] || [ "$(tput colors 2>/dev/null || echo 8)" -ge 256 ]; then
        COLOR_MODE=256
      else
        COLOR_MODE=16
      fi ;;
  esac
fi

# fg R G B → escape sequence for the current colour mode
fg() {
  local r=$1 g=$2 b=$3
  case "$COLOR_MODE" in
    truecolor) printf '\033[38;2;%d;%d;%dm' "$r" "$g" "$b" ;;
    256)
      # nearest colour of the xterm 6x6x6 cube
      local levels=(0 95 135 175 215 255) idx=() c best i d bd
      for c in "$r" "$g" "$b"; do
        best=0; bd=999
        for i in 0 1 2 3 4 5; do
          d=$(( c > levels[i] ? c - levels[i] : levels[i] - c ))
          if [ "$d" -lt "$bd" ]; then bd=$d; best=$i; fi
        done
        idx+=("$best")
      done
      printf '\033[38;5;%dm' $(( 16 + 36 * idx[0] + 6 * idx[1] + idx[2] )) ;;
    *) ;;
  esac
}

if [ "$COLOR_MODE" = none ]; then
  RESET="" BOLD="" DIM="" RED="" GREEN="" YELLOW="" ACCENT="" ACCENT2=""
else
  RESET=$'\033[0m' BOLD=$'\033[1m' DIM=$'\033[2m'
  if [ "$COLOR_MODE" = 16 ]; then
    RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' ACCENT=$'\033[35m' ACCENT2=$'\033[34m'
  else
    RED=$(fg 239 68 68) GREEN=$(fg 34 197 94) YELLOW=$(fg 234 179 8)
    ACCENT=$(fg 139 92 246) ACCENT2=$(fg 59 130 246)
  fi
fi

# ─── Output helpers ──────────────────────────────────────────────────────────

log() { printf '%s %s\n' "$(date '+%F %T')" "$(strip_ansi "$*")" >>"$LOG_FILE" 2>/dev/null || true; }
ok()    { printf '  %s✔%s %s\n' "$GREEN" "$RESET" "$*"; log "OK    $*"; }
warn()  { printf '  %s⚠%s %s\n' "$YELLOW" "$RESET" "$*"; log "WARN  $*"; }
bad()   { printf '  %s✖%s %s\n' "$RED" "$RESET" "$*"; log "ERROR $*"; }
info()  { printf '  %s•%s %s\n' "$DIM" "$RESET" "$*"; log "INFO  $*"; }
# Indented detail lines under a task
sub_ok()   { printf '    %s✔ %s%s\n' "$DIM" "$*" "$RESET"; log "OK    $*"; }
sub_info() { printf '    %s• %s%s\n' "$DIM" "$*" "$RESET"; log "INFO  $*"; }
sub_warn() { printf '    %s⚠%s %s\n' "$YELLOW" "$RESET" "$*"; log "WARN  $*"; }
sub_bad()  { printf '    %s✖%s %s\n' "$RED" "$RESET" "$*"; log "ERROR $*"; }
text()  { printf '  %s\n' "$*"; }
dimtext() { printf '  %s%s%s\n' "$DIM" "$*" "$RESET"; }
# Explanations shown only when a question is actually asked
itext() { [ "$INTERACTIVE" = 0 ] || text "$@"; }
idimtext() { [ "$INTERACTIVE" = 0 ] || dimtext "$@"; }

step() {
  STEP=$((STEP + 1))
  printf '\n%s%s[%d/%d]%s %s%s%s\n' "$BOLD" "$ACCENT" "$STEP" "$TOTAL_STEPS" "$RESET" "$BOLD" "$*" "$RESET"
  log "===== [$STEP/$TOTAL_STEPS] $*"
}

strip_ansi() { printf '%s' "$1" | sed -E $'s/\033\\[[0-9;?]*[A-Za-z]//g'; }

# box "Title" "line" … — frame sized to the longest line (colours allowed)
box() {
  local title=$1 color=${BOX_COLOR:-$ACCENT}; shift
  local width=0 line plain len
  for line in "$@"; do
    plain=$(strip_ansi "$line"); len=${#plain}
    [ "$len" -gt "$width" ] && width=$len
  done
  [ $(( ${#title} + 4 )) -gt "$width" ] && width=$(( ${#title} + 4 ))
  local bar; bar=$(printf '%*s' $(( width + 2 )) '' | sed 's/ /─/g')
  local tbar; tbar=$(printf '%*s' $(( width - ${#title} - 1 )) '' | sed 's/ /─/g')
  printf '  %s╭─ %s%s%s %s╮%s\n' "$color" "$BOLD" "$title" "$RESET$color" "$tbar" "$RESET"
  for line in "$@"; do
    plain=$(strip_ansi "$line")
    printf '  %s│%s %s%*s %s│%s\n' "$color" "$RESET" "$line" $(( width - ${#plain} )) '' "$color" "$RESET"
  done
  printf '  %s╰%s╯%s\n' "$color" "$bar" "$RESET"
}

fmt_duration() {
  local s=$1
  if [ "$s" -ge 60 ]; then printf '%dm%02ds' $((s / 60)) $((s % 60)); else printf '%ds' "$s"; fi
}

spinner_stop() {
  if [ -n "$SPINNER_PID" ]; then
    kill "$SPINNER_PID" 2>/dev/null || true
    wait "$SPINNER_PID" 2>/dev/null || true
    SPINNER_PID=""
  fi
  [ "$IS_TTY" = 1 ] && printf '\033[?25h' || true
}

# spin "Message" command… — runs the command with a spinner, output → log.
# Prints ✔/✖ and returns the exit code of the command (never exits).
spin() {
  local msg=$1; shift
  local start=$SECONDS rc=0 pid
  log "RUN   $msg :: $*"
  if [ -n "${SPIN_INPUT+x}" ]; then
    # Secret input (password, connection URL): fed through a pipe, never
    # through argv, the environment or the log.
    ( trap - ERR; printf '%s\n' "$SPIN_INPUT" | "$@" ) >>"$LOG_FILE" 2>&1 &
  else
    ( trap - ERR; "$@" ) >>"$LOG_FILE" 2>&1 </dev/null &
  fi
  pid=$!
  if [ "$IS_TTY" = 1 ]; then
    (
      trap - ERR
      frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏); i=0
      printf '\033[?25l'
      while :; do
        printf '\r  %s%s%s %s %s%s%s\033[K' "$ACCENT" "${frames[i % 10]}" "$RESET" "$msg" "$DIM" "$(fmt_duration $((SECONDS - start)))" "$RESET"
        i=$((i + 1)); sleep 0.1
      done
    ) &
    SPINNER_PID=$!
  else
    printf '  … %s\n' "$msg"
  fi
  wait "$pid" || rc=$?
  spinner_stop
  [ "$IS_TTY" = 1 ] && printf '\r\033[K'
  if [ "$rc" -eq 0 ]; then
    ok "$msg ${DIM}($(fmt_duration $((SECONDS - start))))${RESET}"
  else
    bad "$msg"
    log "FAIL  $msg (exit code $rc)"
  fi
  return "$rc"
}

# run_task "Message" command… — like spin, but aborts the installation on failure.
run_task() {
  local msg=$1
  spin "$@" || die "$msg failed."
}

die() {
  trap - ERR
  spinner_stop
  restore_tty
  printf '\n'
  bad "$1"
  if [ "${2:-}" != "nolog" ] && [ -s "$LOG_FILE" ]; then
    printf '\n  %sLast lines of the log:%s\n' "$DIM" "$RESET"
    tail -n 20 "$LOG_FILE" | sed "s/^/    ${DIM}│${RESET} /"
  fi
  printf '\n  Full log: %s\n\n' "$LOG_FILE"
  exit 1
}

restore_tty() {
  if [ -n "$STTY_SAVED" ]; then
    stty "$STTY_SAVED" </dev/tty 2>/dev/null || true
    STTY_SAVED=""
  fi
}

on_error() {
  local rc=$? line=$1 cmd=$2
  die "Unexpected error (exit code $rc) on line $line: $cmd"
}

on_interrupt() {
  trap - ERR INT TERM
  spinner_stop
  restore_tty
  printf '\n\n'
  bad "Installation interrupted."
  printf '  Full log: %s\n\n' "$LOG_FILE"
  exit 130
}

cleanup() {
  spinner_stop
  restore_tty
  if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi
  return 0
}

trap 'on_error $LINENO "$BASH_COMMAND"' ERR
trap on_interrupt INT TERM
trap cleanup EXIT

# ─── Banner ──────────────────────────────────────────────────────────────────

print_banner() {
  local version_label=$1
  local -a lines
  mapfile -t lines <<'BANNER'
██╗  ██╗ ██╗   ██╗ ███╗   ███╗ ██████╗  ██╗      ███████╗
██║  ██║ ██║   ██║ ████╗ ████║ ██╔══██╗ ██║      ██╔════╝
███████║ ██║   ██║ ██╔████╔██║ ██████╔╝ ██║      █████╗
██╔══██║ ██║   ██║ ██║╚██╔╝██║ ██╔══██╗ ██║      ██╔══╝
██║  ██║ ╚██████╔╝ ██║ ╚═╝ ██║ ██████╔╝ ███████╗ ███████╗
╚═╝  ╚═╝  ╚═════╝  ╚═╝     ╚═╝ ╚═════╝  ╚══════╝ ╚══════╝
██████╗  ██╗       █████╗  ███╗   ██╗ ███╗   ██╗ ██╗ ███╗   ██╗  ██████╗
██╔══██╗ ██║      ██╔══██╗ ████╗  ██║ ████╗  ██║ ██║ ████╗  ██║ ██╔════╝
██████╔╝ ██║      ███████║ ██╔██╗ ██║ ██╔██╗ ██║ ██║ ██╔██╗ ██║ ██║  ███╗
██╔═══╝  ██║      ██╔══██║ ██║╚██╗██║ ██║╚██╗██║ ██║ ██║╚██╗██║ ██║   ██║
██║      ███████╗ ██║  ██║ ██║ ╚████║ ██║ ╚████║ ██║ ██║ ╚████║ ╚██████╔╝
╚═╝      ╚══════╝ ╚═╝  ╚═╝ ╚═╝  ╚═══╝ ╚═╝  ╚═══╝ ╚═╝ ╚═╝  ╚═══╝  ╚═════╝
BANNER
  local cols=${COLUMNS:-}
  [ -z "$cols" ] && cols=$(tput cols 2>/dev/null || echo 80)
  printf '\n'
  if [ "$cols" -lt 77 ]; then
    printf '  %s%sHUMBLE PLANNING%s\n' "$BOLD" "$ACCENT" "$RESET"
  else
    # Vertical gradient #7c3aed → #3b82f6, one colour per line
    local n=${#lines[@]} i r g b color
    for ((i = 0; i < n; i++)); do
      r=$(( 124 + (59 - 124) * i / (n - 1) ))
      g=$(( 58 + (130 - 58) * i / (n - 1) ))
      b=$(( 237 + (246 - 237) * i / (n - 1) ))
      if [ "$COLOR_MODE" = 16 ]; then
        if [ "$i" -lt $((n / 2)) ]; then color=$ACCENT; else color=$ACCENT2; fi
      else
        color=$(fg "$r" "$g" "$b")
      fi
      printf '  %s%s%s\n' "$color" "${lines[i]}" "$RESET"
    done
  fi
  printf '\n  %s%s · Open-source planning — AGPL-3.0%s\n' "$DIM" "$version_label" "$RESET"
}

# ─── Generic helpers ─────────────────────────────────────────────────────────

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# version_ge A B → A >= B
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }

gen_secret() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }

urlencode() {
  local LC_ALL=C s=$1 out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case "$c" in
      [A-Za-z0-9._~-]) out+=$c ;;
      *) printf -v c '%%%02X' "'$c"; out+=${c: -3} ;;
    esac
  done
  printf '%s' "$out"
}

has_systemd() { [ -d /run/systemd/system ]; }

docker_ok() { docker info >/dev/null 2>&1; }

compose() {
  docker compose --project-directory "$INSTALL_DIR" -f "$INSTALL_DIR/docker-compose.yml" "$@"
}

# Is a TCP port listening on this host?
port_in_use() {
  local p=$1
  if has_cmd ss; then
    [ -n "$(ss -Hltn "( sport = :$p )" 2>/dev/null)" ]
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null
  fi
}

port_owner() {
  has_cmd ss || return 0
  ss -Hltnp "( sport = :$1 )" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | sed -n 1p
  return 0
}

is_ipv4() { [[ $1 =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; }
is_ip() { is_ipv4 "$1" || [[ $1 == *:* ]]; }

# A name that can get a public certificate: not an IP, not a local name.
is_public_domain() {
  local h=$1
  ! is_ip "$h" && [[ $h == *.* ]] && [[ $h =~ \.[a-z]{2,}$ ]] && [[ ! $h =~ \.(local|localhost|internal|lan|home|test|invalid|example)$ ]]
}

# ─── Prompts (always read from /dev/tty: works with `curl … | sudo bash`) ────

# ask VAR "Question" "default" [validator] [ENV_NAME]
ask() {
  local __var=$1 __q=$2 __def=${3:-} __val=${4:-} __env=${5:-} __ans __err
  if [ "$INTERACTIVE" = 0 ]; then
    __ans=$__def
    if [ -n "$__val" ] && ! __err=$("$__val" "$__ans"); then
      die "Missing or invalid value for ${__env:-$__q}: $__err" nolog
    fi
    printf -v "$__var" '%s' "$__ans"
    return 0
  fi
  while :; do
    printf '  %s?%s %s' "$ACCENT" "$RESET" "$__q"
    [ -n "$__def" ] && printf ' %s[%s]%s' "$DIM" "$__def" "$RESET"
    printf ' '
    IFS= read -r __ans </dev/tty || die "No input available." nolog
    __ans=${__ans#"${__ans%%[![:space:]]*}"}
    __ans=${__ans%"${__ans##*[![:space:]]}"}
    __ans=${__ans:-$__def}
    if [ -n "$__val" ] && ! __err=$("$__val" "$__ans"); then
      printf '    %s✖ %s%s\n' "$RED" "$__err" "$RESET"
      continue
    fi
    break
  done
  log "ASK   $__q → $__ans"
  printf -v "$__var" '%s' "$__ans"
}

# ask_yes_no "Question" y|n → status 0 for yes
ask_yes_no() {
  local q=$1 def=$2 ans hint
  if [ "$INTERACTIVE" = 0 ]; then [ "$def" = y ]; return; fi
  if [ "$def" = y ]; then hint="Y/n"; else hint="y/N"; fi
  while :; do
    printf '  %s?%s %s %s[%s]%s ' "$ACCENT" "$RESET" "$q" "$DIM" "$hint" "$RESET"
    IFS= read -r ans </dev/tty || die "No input available." nolog
    ans=${ans:-$def}
    case "${ans,,}" in
      y|yes) log "ASK   $q → yes"; return 0 ;;
      n|no) log "ASK   $q → no"; return 1 ;;
      *) printf '    %s✖ Please answer yes or no.%s\n' "$RED" "$RESET" ;;
    esac
  done
}

confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  ask_yes_no "$1" y
}

# ask_choice VAR "Question" default_index "Option 1" "Option 2"… → VAR = 1-based index
ask_choice() {
  local __var=$1 __q=$2 __def=$3; shift 3
  local __n=$# __i __ans __opt
  if [ "$INTERACTIVE" = 0 ]; then printf -v "$__var" '%s' "$__def"; return 0; fi
  printf '  %s?%s %s\n' "$ACCENT" "$RESET" "$__q"
  __i=1
  for __opt in "$@"; do
    printf '      %s%d)%s %s\n' "$ACCENT" "$__i" "$RESET" "$__opt"
    __i=$((__i + 1))
  done
  while :; do
    printf '    Choice %s[%s]%s ' "$DIM" "$__def" "$RESET"
    IFS= read -r __ans </dev/tty || die "No input available." nolog
    __ans=${__ans:-$__def}
    if [[ $__ans =~ ^[0-9]+$ ]] && [ "$__ans" -ge 1 ] && [ "$__ans" -le "$__n" ]; then break; fi
    printf '    %s✖ Please enter a number between 1 and %d.%s\n' "$RED" "$__n" "$RESET"
  done
  log "ASK   $__q → $__ans"
  printf -v "$__var" '%s' "$__ans"
}

# read_secret VAR "Prompt" — masked input (one • per character)
read_secret() {
  local __var=$1 __prompt=$2 __secret="" __c
  printf '  %s?%s %s ' "$ACCENT" "$RESET" "$__prompt"
  STTY_SAVED=$(stty -g </dev/tty)
  stty -echo </dev/tty
  while IFS= read -r -n1 __c </dev/tty; do
    if [ -z "$__c" ]; then
      break
    elif [ "$__c" = $'\x7f' ] || [ "$__c" = $'\b' ]; then
      if [ -n "$__secret" ]; then __secret=${__secret%?}; printf '\b \b'; fi
    elif [[ $__c == [[:cntrl:]] ]]; then
      continue
    else
      __secret+=$__c
      printf '%s•%s' "$ACCENT" "$RESET"
    fi
  done
  restore_tty
  printf '\n'
  printf -v "$__var" '%s' "$__secret"
}

# ─── Validators (print the reason and fail) ──────────────────────────────────

URL_SCHEME="" URL_HOST="" URL_PORT=""
parse_url() {
  local u=${1%/}
  if [[ $u =~ ^(https?)://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:([0-9]{1,5}))?$ ]]; then
    URL_SCHEME=${BASH_REMATCH[1]}
    URL_HOST=${BASH_REMATCH[2],,}
    URL_PORT=${BASH_REMATCH[4]}
    return 0
  fi
  return 1
}

validate_url() {
  if [ -z "$1" ]; then echo "A public URL is required."; return 1; fi
  if ! parse_url "$1"; then
    echo "Enter a URL like https://planning.example.com (no path)."
    return 1
  fi
}

validate_dir() {
  if [[ $1 != /* ]]; then echo "Use an absolute path."; return 1; fi
  if [[ $1 == *[[:space:]]* ]]; then echo "The path cannot contain spaces."; return 1; fi
  if [ "$1" = / ]; then echo "Choose a dedicated directory."; return 1; fi
}

validate_required() { [ -n "$1" ] || { echo "This value is required."; return 1; }; }

validate_host() {
  [[ $1 =~ ^[A-Za-z0-9.:-]+$ ]] || { echo "Enter a host name or an IP address."; return 1; }
}

validate_port() {
  [[ $1 =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ] || { echo "Enter a port between 1 and 65535."; return 1; }
}

validate_identifier() {
  [[ $1 =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || { echo "Use letters, digits and underscores (max 63)."; return 1; }
}

validate_ssl() {
  [[ $1 == require || $1 == disable ]] || { echo "Answer require or disable."; return 1; }
}

validate_email_optional() {
  [ -z "$1" ] && return 0
  [[ $1 =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "Enter a valid e-mail address, or leave it empty."; return 1; }
}

validate_username() {
  [[ $1 =~ $USERNAME_PATTERN ]] || {
    echo "Use 2 to 100 letters, digits, dots, dashes, underscores or @, starting with a letter or a digit."
    return 1
  }
}

validate_time() {
  [[ $1 =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "Enter a time between 00:00 and 23:59 (HH:MM)."; return 1; }
}

# A value written as is in .env (same rule as env_plan)
validate_env_value() {
  validate_required "$1" || return 1
  [[ $1 != *[[:space:]\"\'\\\$\#\`]* ]] || { echo "Spaces, quotes and the characters \\ \$ # \` are not allowed."; return 1; }
}

# ─── .env management (atomic, never overwrites a secret) ─────────────────────

declare -A ENV_VALUE=() ENV_SECTION=() ENV_UNSET=()
ENV_KEYS=()
ENV_CHANGED=0

env_get() {
  [ -f "$INSTALL_DIR/.env" ] || return 0
  local line val=""
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line =~ ^[[:space:]]*$1=(.*)$ ]]; then val=${BASH_REMATCH[1]}; fi
  done <"$INSTALL_DIR/.env"
  val=${val%$'\r'}
  if [[ $val =~ ^\"(.*)\"$ ]] || [[ $val =~ ^\'(.*)\'$ ]]; then val=${BASH_REMATCH[1]}; fi
  printf '%s' "$val"
}

env_has() { [ -f "$INSTALL_DIR/.env" ] && grep -q "^$1=" "$INSTALL_DIR/.env"; }

is_placeholder() {
  local v=${1,,}
  [ -z "$v" ] && return 0
  [[ $v == *generate* || $v == *your-secret* || $v == *change-me* || $v == *placeholder* || $v == *yourdomain* || $v == *humbleplanning-internal* ]]
}

# env_plan SECTION KEY VALUE keep|set
#   keep: only written when missing or still a placeholder (secrets)
#   set:  always written (settings chosen during this run)
env_plan() {
  local section=$1 key=$2 value=$3 mode=$4 current
  if [[ $value == *[[:space:]\"\'\\\$\#\`]* ]]; then die "Refusing to write an unsafe value for $key in .env." nolog; fi
  current=$(env_get "$key")
  if [ "$mode" = keep ] && ! is_placeholder "$current"; then
    return 0
  fi
  if [ "$current" = "$value" ] && env_has "$key"; then return 0; fi
  [ -z "${ENV_VALUE[$key]+x}" ] && ENV_KEYS+=("$key")
  ENV_VALUE[$key]=$value
  ENV_SECTION[$key]=$section
}

# env_unset KEY — removes the key from .env (setting that no longer applies)
env_unset() {
  env_has "$1" && ENV_UNSET[$1]=1
  return 0
}

# Writes the planned values: existing lines are updated in place (or dropped
# by env_unset), new keys are appended by section. Atomic (temp file +
# rename), mode 600.
env_commit() {
  [ "${#ENV_KEYS[@]}" -eq 0 ] && [ "${#ENV_UNSET[@]}" -eq 0 ] && return 0
  local file="$INSTALL_DIR/.env" tmp line key section
  declare -A done_keys=()
  tmp=$(mktemp "$INSTALL_DIR/.env.XXXXXX")
  chmod 600 "$tmp"
  if [ -f "$file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ $line =~ ^([A-Z_][A-Z0-9_]*)= ]] && [ -n "${ENV_UNSET[${BASH_REMATCH[1]}]+x}" ]; then
        continue
      elif [[ $line =~ ^([A-Z_][A-Z0-9_]*)= ]] && [ -n "${ENV_VALUE[${BASH_REMATCH[1]}]+x}" ]; then
        key=${BASH_REMATCH[1]}
        printf '%s=%s\n' "$key" "${ENV_VALUE[$key]}" >>"$tmp"
        done_keys[$key]=1
      else
        printf '%s\n' "$line" >>"$tmp"
      fi
    done <"$file"
  else
    {
      printf '# Humble Planning — configuration generated by install.sh on %s.\n' "$(date '+%F %T')"
      printf '# Keep this file private. install.sh never overwrites the secrets below.\n'
    } >>"$tmp"
  fi
  local sections=() s
  for key in "${ENV_KEYS[@]}"; do
    [ -n "${done_keys[$key]+x}" ] && continue
    s=${ENV_SECTION[$key]}
    [[ " ${sections[*]} " == *" $s "* ]] || sections+=("$s")
  done
  for section in "${sections[@]}"; do
    printf '\n# --- %s ---\n' "$section" >>"$tmp"
    for key in "${ENV_KEYS[@]}"; do
      [ -n "${done_keys[$key]+x}" ] && continue
      [ "${ENV_SECTION[$key]}" = "$section" ] || continue
      printf '%s=%s\n' "$key" "${ENV_VALUE[$key]}" >>"$tmp"
    done
  done
  mv -f "$tmp" "$file"
  chmod 600 "$file"
  ENV_CHANGED=1
  log "ENV   updated: ${ENV_KEYS[*]}${ENV_UNSET[*]+ removed: ${!ENV_UNSET[*]}}"
  ENV_KEYS=(); ENV_VALUE=(); ENV_SECTION=(); ENV_UNSET=()
}

# ─── Files from the repository ───────────────────────────────────────────────

SOURCE_DIR=""
REPO_RAW=${HP_REPO_RAW:-$DEFAULT_REPO_RAW}

# fetch_file deploy/docker-compose.yml DEST
fetch_file() {
  local rel=$1 dest=$2
  if [ -n "$SOURCE_DIR" ]; then
    cp "$SOURCE_DIR/$rel" "$dest"
  else
    curl -fsSL --retry 3 "$REPO_RAW/$rel" -o "$dest"
  fi
}

detect_source_dir() {
  local script_dir=""
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  fi
  if [ -n "${HP_SOURCE_DIR:-}" ]; then
    SOURCE_DIR=$HP_SOURCE_DIR
  elif [ -n "${HP_BUILD_SOURCE:-}" ] && [ -f "${HP_BUILD_SOURCE}/deploy/docker-compose.yml" ]; then
    SOURCE_DIR=$HP_BUILD_SOURCE
  elif [ -n "$script_dir" ] && [ -f "$script_dir/deploy/docker-compose.yml" ]; then
    SOURCE_DIR=$script_dir
  fi
  if [ -n "$SOURCE_DIR" ] && [ ! -f "$SOURCE_DIR/deploy/docker-compose.yml" ]; then
    die "HP_SOURCE_DIR ($SOURCE_DIR) does not contain deploy/docker-compose.yml." nolog
  fi
}

source_version() {
  local v=""
  if [ -n "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/package.json" ]; then
    v=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$SOURCE_DIR/package.json" | sed -n 1p)
  fi
  printf '%s' "$v"
}

# Renders deploy/Caddyfile: keeps the #@<name> blocks listed in $1 (comma
# separated; a block nested in a skipped block is skipped too), replaces the
# placeholders.
render_caddyfile() {
  local blocks=$1 site=$2 email=$3 template=$4
  printf '# Humble Planning — generated by install.sh on %s from deploy/Caddyfile.\n' "$(date '+%F')"
  awk -v keep=",$blocks," -v site="$site" -v email="$email" '
    /^[[:space:]]*#@end[[:space:]]*$/ { if (depth > 0) skip = outer[depth--]; next }
    /^[[:space:]]*#@[a-z_]+[[:space:]]*$/ {
      name = $0; gsub(/[[:space:]#@]/, "", name)
      outer[++depth] = skip
      skip = skip || (index(keep, "," name ",") == 0); next
    }
    skip { next }
    /^[[:space:]]*$/ { if (blank) next; blank = 1; print ""; next }
    { blank = 0; gsub(/__SITE_ADDRESS__/, site); gsub(/__ACME_EMAIL__/, email); print }
  ' "$template"
}

# ─── Cloudflare ──────────────────────────────────────────────────────────────

CF_ERROR="" CF_ZONE=""

cf_api() {
  # The token is sent through stdin (curl -H @-), never on the command line.
  printf 'Authorization: Bearer %s\n' "$1" |
    curl -sS --max-time 20 -H @- -H 'Content-Type: application/json' "https://api.cloudflare.com/client/v4$2"
}

cf_message() { grep -o '"message":"[^"]*"' <<<"$1" | sed -n 1p | cut -d'"' -f4 || true; }

cf_check_token() {
  local token=$1 host=$2 body candidate
  CF_ERROR="" CF_ZONE=""
  if ! body=$(cf_api "$token" "/user/tokens/verify" 2>&1); then
    CF_ERROR="Could not reach api.cloudflare.com: $body"; return 1
  fi
  if [[ $body != *'"success":true'* || $body != *'"status":"active"'* ]]; then
    CF_ERROR="Cloudflare rejected the token: $(cf_message "$body")"
    [ "$CF_ERROR" = "Cloudflare rejected the token: " ] && CF_ERROR="Cloudflare rejected the token."
    return 1
  fi
  candidate=$host
  while [[ $candidate == *.* ]]; do
    body=$(cf_api "$token" "/zones?name=$candidate" 2>&1) || { CF_ERROR="Could not reach api.cloudflare.com."; return 1; }
    if [[ $body == *'"success":false'* ]]; then
      CF_ERROR="Cloudflare refused to list zones: $(cf_message "$body") (add the Zone → Zone → Read permission)."
      return 1
    fi
    if [[ $body == *'"success":true'* && $body != *'"result":[]'* ]]; then
      CF_ZONE=$candidate; return 0
    fi
    candidate=${candidate#*.}
  done
  CF_ERROR="The token is valid but no Cloudflare zone is visible for $host. Check \"Zone Resources\" and the Zone → Zone → Read permission."
  return 1
}

cloudflare_instructions() {
  local zone=$1
  BOX_COLOR=$ACCENT2 box "How to create a Cloudflare API token" \
    "1. Log in to the Cloudflare dashboard:" \
    "   ${BOLD}https://dash.cloudflare.com/profile/api-tokens${RESET}" \
    "2. Click \"Create Token\", then use the \"Edit zone DNS\" template." \
    "3. Permissions: keep Zone → DNS → Edit, and add Zone → Zone → Read." \
    "4. Zone Resources: Include → Specific zone → ${BOLD}${zone}${RESET}" \
    "5. Click \"Continue to summary\", then \"Create Token\", and copy the" \
    "   token. It is shown only once."
}

# ─── Configuration state ─────────────────────────────────────────────────────

MODE=install          # install | update
INSTANCE=production   # production | demo
DEMO_LOGIN="" DEMO_PASSWORD="" DEMO_RESET_TIME=""
APP_URL="" INSTALL_DIR="" DB_MODE=builtin
DB_HOST="" DB_PORT="" DB_NAME="" DB_USER="" DB_PASSWORD="" DB_SSL=""
CADDY=0 TLS_MODE=none ACME_EMAIL="" CLOUDFLARE=0 CF_TOKEN="" CF_PROXY=0 CADDYFILE_UPDATED=0
APP_REPO="" CADDY_REPO="" APP_IMAGE="" CADDY_IMAGE="" APP_PORT="" SOCKET_PORT="" HTTP_PORT="" HTTPS_PORT=""
AUTO_UPDATE=0
OS_ID="" OS_VERSION_ID="" OS_PRETTY="" OS_CODENAME="" DOCKER_DIST="" DOCKER_SUITE=""
DOCKER_VERSION="" COMPOSE_VERSION="" DOCKER_READY=0 ARCH=""
ADMIN_USER="" ADMIN_CREATED=0 BACKUP_KEY_NEW="" APP_VERSION=""

existing_install() {
  [ -f "$1/.env" ] && [ -f "$1/docker-compose.yml" ] && grep -q '^APP_BASE_URL=' "$1/.env"
}

# ─── Step 1: system requirements ─────────────────────────────────────────────

detect_docker() {
  DOCKER_VERSION="" COMPOSE_VERSION="" DOCKER_READY=0
  has_cmd docker || return 0
  DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)
  [ -z "$DOCKER_VERSION" ] && DOCKER_VERSION=$(docker version --format '{{.Client.Version}}' 2>/dev/null || true)
  COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || true)
  COMPOSE_VERSION=${COMPOSE_VERSION#v}
  if [ -n "$DOCKER_VERSION" ] && version_ge "${DOCKER_VERSION%%[+~-]*}" "$MIN_DOCKER" &&
     [ -n "$COMPOSE_VERSION" ] && version_ge "${COMPOSE_VERSION%%[+~-]*}" "$MIN_COMPOSE"; then
    DOCKER_READY=1
  fi
}

install_prerequisites() {
  apt-get -o DPkg::Lock::Timeout=300 update
  apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends ca-certificates curl iproute2
}

check_system() {
  step "Checking system requirements"

  [ "$(id -u)" -eq 0 ] || die "This installer must run as root: sudo bash install.sh" nolog
  ok "Running as root"

  [ "$(uname -s)" = Linux ] || die "Humble Planning can only be installed on Linux." nolog

  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID=${ID:-} OS_VERSION_ID=${VERSION_ID:-} OS_PRETTY=${PRETTY_NAME:-Linux} OS_CODENAME=${VERSION_CODENAME:-}
    case "$OS_ID:$OS_VERSION_ID" in
      ubuntu:22.04|ubuntu:24.04) DOCKER_DIST=ubuntu DOCKER_SUITE=${UBUNTU_CODENAME:-$OS_CODENAME} ;;
      debian:12|debian:13) DOCKER_DIST=debian DOCKER_SUITE=$OS_CODENAME ;;
      *)
        if [ "${HP_FORCE_OS:-0}" = 1 ]; then
          if [[ " ${ID_LIKE:-} " == *" ubuntu "* ]]; then DOCKER_DIST=ubuntu DOCKER_SUITE=${UBUNTU_CODENAME:-$OS_CODENAME}
          elif [[ " ${ID_LIKE:-} " == *" debian "* ]]; then DOCKER_DIST=debian DOCKER_SUITE=$OS_CODENAME
          fi
        fi ;;
    esac
  fi

  detect_docker
  if [ -n "$DOCKER_DIST" ]; then
    ok "Operating system: $OS_PRETTY"
  elif [ "$DOCKER_READY" = 1 ]; then
    ok "Operating system: $OS_PRETTY (Docker already installed)"
  else
    bad "Operating system: $OS_PRETTY"
    die "Docker can only be installed automatically on Ubuntu 22.04/24.04 LTS and Debian 12/13. Install Docker ${MIN_DOCKER}+ with Compose ${MIN_COMPOSE}+ first, or set HP_FORCE_OS=1 on a Debian/Ubuntu derivative." nolog
  fi

  case "$(uname -m)" in
    x86_64|amd64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) die "Unsupported architecture: $(uname -m) (amd64 or arm64 required)." nolog ;;
  esac
  ok "Architecture: $ARCH"

  local mem_kb mem_gb
  mem_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
  mem_gb=$(awk -v k="$mem_kb" 'BEGIN {printf "%.1f", k / 1048576}')
  if [ "$mem_kb" -lt 1900000 ]; then
    warn "Memory: $mem_gb GB — 2 GB or more is recommended (4 GB to build the images from source)"
  else
    ok "Memory: $mem_gb GB"
  fi

  local disk_path=/ free_kb free_gb
  [ -d /var/lib/docker ] && disk_path=/var/lib/docker
  free_kb=$(df -Pk "$disk_path" | awk 'NR == 2 {print $4}')
  free_gb=$(awk -v k="$free_kb" 'BEGIN {printf "%.1f", k / 1048576}')
  if [ "$free_kb" -lt 3145728 ]; then
    bad "Free disk space: $free_gb GB on $disk_path"
    die "At least 3 GB of free disk space is required." nolog
  fi
  ok "Free disk space: $free_gb GB"

  if ! has_cmd curl || { [ -n "$DOCKER_DIST" ] && ! has_cmd ss; }; then
    if [ -n "$DOCKER_DIST" ]; then
      run_task "Installing prerequisites (curl, ca-certificates, iproute2)" install_prerequisites
    else
      has_cmd curl || die "curl is required: please install it first." nolog
    fi
  fi

  if curl -sS -o /dev/null --max-time 15 https://ghcr.io/v2/ 2>>"$LOG_FILE"; then
    ok "Internet access"
  elif [ -n "${HP_IMAGE_ARCHIVE:-}" ] && [ "$DOCKER_READY" = 1 ]; then
    warn "No Internet access: continuing with the images from $HP_IMAGE_ARCHIVE"
  else
    die "No Internet access (https://ghcr.io is unreachable). Check the network, DNS or proxy settings." nolog
  fi

  if has_systemd; then
    ok "systemd detected"
  else
    warn "systemd not detected: Docker will be started in the background and will not start automatically at boot"
  fi

  if [ "$DOCKER_READY" = 1 ]; then
    ok "Docker $DOCKER_VERSION with Compose $COMPOSE_VERSION"
  elif [ -n "$DOCKER_VERSION" ]; then
    warn "Docker ${DOCKER_VERSION} / Compose ${COMPOSE_VERSION:-missing} found: Docker ${MIN_DOCKER}+ and Compose ${MIN_COMPOSE}+ will be installed"
    [ -n "$DOCKER_DIST" ] || die "Please upgrade Docker manually." nolog
  else
    info "Docker not found: it will be installed from the official Docker repository"
  fi
}

# ─── Step 2: configuration ───────────────────────────────────────────────────

ask_external_db() {
  itext ""
  idimtext "Connection details of your PostgreSQL server (version 16 or later)."
  ask DB_HOST "Database host" "${DB_HOST:-${HP_DB_HOST:-}}" validate_host HP_DB_HOST
  if [[ $DB_HOST =~ ^(localhost|127\.[0-9.]+|::1)$ ]]; then
    info "Inside the containers, \"$DB_HOST\" is the container itself: using host.docker.internal (the Docker host) instead."
    info "PostgreSQL must listen on the Docker bridge and allow it in pg_hba.conf."
    DB_HOST=host.docker.internal
  fi
  ask DB_PORT "Port" "${DB_PORT:-${HP_DB_PORT:-5432}}" validate_port HP_DB_PORT
  ask DB_NAME "Database name" "${DB_NAME:-${HP_DB_NAME:-humble_planning}}" validate_required HP_DB_NAME
  ask DB_USER "User" "${DB_USER:-${HP_DB_USER:-humbleplanning}}" validate_required HP_DB_USER
  if [ "$INTERACTIVE" = 1 ]; then
    while :; do
      read_secret DB_PASSWORD "Password"
      [ -n "$DB_PASSWORD" ] && break
      printf '    %s✖ The password cannot be empty.%s\n' "$RED" "$RESET"
    done
  else
    DB_PASSWORD=${HP_DB_PASSWORD:-}
    [ -n "$DB_PASSWORD" ] || die "HP_DB_PASSWORD is required with HP_DB_MODE=external." nolog
  fi
  local ssl_default=require
  [[ $DB_HOST == host.docker.internal ]] && ssl_default=disable
  ask DB_SSL "SSL mode (require or disable)" "${DB_SSL:-${HP_DB_SSL:-$ssl_default}}" validate_ssl HP_DB_SSL
}

external_db_url() {
  local host=$DB_HOST
  [[ $host == *:* ]] && host="[$host]"
  printf 'postgresql://%s:%s@%s:%s/%s?sslmode=%s' \
    "$(urlencode "$DB_USER")" "$(urlencode "$DB_PASSWORD")" "$host" "$DB_PORT" "$(urlencode "$DB_NAME")" "$DB_SSL"
}

# Pick a free loopback port for the app or Socket.io server.
choose_port() {
  local __var=$1 label=$2 port=$3 env=$4
  while port_in_use "$port"; do
    if [ "$INTERACTIVE" = 0 ]; then
      die "Port $port ($label) is already in use on this server. Set $env to a free port." nolog
    fi
    local owner
    owner=$(port_owner "$port")
    warn "Port $port ($label) is already in use${owner:+ by $owner}."
    ask port "Another local port for the $label" "$((port + 10))" validate_port "$env"
  done
  printf -v "$__var" '%s' "$port"
}

configure_caddy() {
  CADDY=0 TLS_MODE=none CLOUDFLARE=0 CF_TOKEN="" ACME_EMAIL=""
  local default=n
  is_public_domain "$URL_HOST" && default=y
  if [ -n "${HP_CADDY:-}" ]; then
    if [ "$HP_CADDY" = 1 ]; then default=y; else default=n; fi
  fi

  itext ""
  idimtext "Caddy is a web server that gets and renews HTTPS certificates automatically"
  idimtext "and routes the real-time (Socket.io) traffic to the right container."
  ask_yes_no "Do you want to install a reverse proxy (Caddy)?" "$default" || return 0

  if [ -n "$URL_PORT" ] && ! { [ "$URL_SCHEME" = https ] && [ "$URL_PORT" = 443 ]; } && ! { [ "$URL_SCHEME" = http ] && [ "$URL_PORT" = 80 ]; }; then
    warn "With Caddy, the public URL cannot include a custom port ($URL_PORT): continuing without Caddy."
    return 0
  fi

  HTTP_PORT=${HP_HTTP_PORT:-80} HTTPS_PORT=${HP_HTTPS_PORT:-443}
  local busy=() p owner
  for p in "$HTTP_PORT" "$HTTPS_PORT"; do
    if port_in_use "$p"; then
      owner=$(port_owner "$p")
      busy+=("$p${owner:+ ($owner)}")
    fi
  done
  if [ "${#busy[@]}" -gt 0 ]; then
    warn "Port(s) ${busy[*]} already in use: another web server (nginx, Apache…) is probably running."
    dimtext "Caddy needs ports $HTTP_PORT and $HTTPS_PORT. You can keep your web server and use it as the"
    dimtext "reverse proxy instead: an nginx example is shown at the end of the installation."
    if [ "$INTERACTIVE" = 0 ]; then
      die "Ports ${busy[*]} are in use: free them or set HP_CADDY=0." nolog
    fi
    local choice
    ask_choice choice "What do you want to do?" 1 "Continue without Caddy" "Abort the installation"
    [ "$choice" = 1 ] && return 0
    die "Installation aborted: free ports $HTTP_PORT/$HTTPS_PORT, then run the installer again." nolog
  fi

  CADDY=1
  if [ "$URL_SCHEME" = https ] && is_public_domain "$URL_HOST"; then
    TLS_MODE=acme
  else
    TLS_MODE=http
    if is_ip "$URL_HOST" || [ "$URL_SCHEME" = http ]; then
      warn "No certificate can be issued for $URL_SCHEME://$URL_HOST: Caddy will serve plain HTTP on port $HTTP_PORT."
    else
      warn "$URL_HOST is not a public domain name: Caddy will serve plain HTTP on port $HTTP_PORT."
    fi
    if [ "$URL_SCHEME" = https ]; then
      APP_URL="http://$URL_HOST"; URL_SCHEME=http
      info "Public URL changed to $APP_URL (secure cookies require HTTPS)."
    fi
    return 0
  fi

  ask ACME_EMAIL "E-mail address for Let's Encrypt notices (optional)" "${HP_ACME_EMAIL:-}" validate_email_optional HP_ACME_EMAIL

  local cf_default=n
  [ "${HP_CLOUDFLARE:-0}" = 1 ] && cf_default=y
  ask_yes_no "Do you use Cloudflare to manage the DNS of this domain?" "$cf_default" || return 0

  local zone_guess
  zone_guess=$(awk -F. '{ if (NF >= 2) print $(NF-1) "." $NF; else print $0 }' <<<"$URL_HOST")
  if [ "$INTERACTIVE" = 0 ]; then
    CF_TOKEN=${HP_CLOUDFLARE_API_TOKEN:-}
    [ -n "$CF_TOKEN" ] || die "HP_CLOUDFLARE_API_TOKEN is required with HP_CLOUDFLARE=1." nolog
    if cf_check_token "$CF_TOKEN" "$URL_HOST"; then
      ok "Cloudflare token is valid — zone: $CF_ZONE"
      CLOUDFLARE=1; return 0
    fi
    die "Cloudflare API token rejected: $CF_ERROR" nolog
  fi

  text ""
  cloudflare_instructions "$zone_guess"
  text ""
  while :; do
    read_secret CF_TOKEN "Cloudflare API token"
    if [ -z "$CF_TOKEN" ]; then
      printf '    %s✖ The token cannot be empty.%s\n' "$RED" "$RESET"
      continue
    fi
    if cf_check_token "$CF_TOKEN" "$URL_HOST"; then
      ok "Cloudflare token is valid — zone: $CF_ZONE"
      CLOUDFLARE=1; return 0
    fi
    bad "$CF_ERROR"
    local choice
    ask_choice choice "What do you want to do?" 1 "Enter the token again" "Continue without Cloudflare (HTTP challenge)"
    if [ "$choice" = 2 ]; then CF_TOKEN=""; return 0; fi
  done
}

# Behind the Cloudflare proxy, the visitor address comes from CF-Connecting-IP,
# which anyone can send: Caddy only reads it on connections from Cloudflare's
# addresses; without Caddy, the application trusts it (TRUSTED_PROXY=cloudflare)
# and the server must only accept traffic from Cloudflare.
configure_cloudflare_proxy() {
  local default=n
  [ "${HP_CLOUDFLARE_PROXY:-0}" = 1 ] && default=y
  itext ""
  idimtext "With the Cloudflare proxy (orange cloud), visitors reach this server through Cloudflare."
  if ask_yes_no "Is the site served through the Cloudflare proxy?" "$default"; then CF_PROXY=1; else CF_PROXY=0; fi
}

# Application time zone: HP_TIMEZONE, else the server time zone, else Europe/Paris
detect_timezone() {
  local tz=${HP_TIMEZONE:-}
  if [ -z "$tz" ]; then
    tz=$(timedatectl show -p Timezone --value 2>/dev/null || true)
    [ -z "$tz" ] && [ -f /etc/timezone ] && tz=$(head -n1 /etc/timezone)
    [ -z "$tz" ] && [ -L /etc/localtime ] && tz=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||')
    [[ $tz =~ ^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$ ]] || tz=Europe/Paris
  fi
  printf '%s' "$tz"
}

configure_instance() {
  local default=1 choice
  case "${HP_INSTANCE:-production}" in
    production) ;;
    demo) default=2 ;;
    *) die "Invalid HP_INSTANCE \"$HP_INSTANCE\": use production or demo." nolog ;;
  esac
  itext ""
  ask_choice choice "Instance type" "$default" \
    "Production — your organisation's planning (recommended)" \
    "Demo — public demonstration, all data reset every night"
  if [ "$choice" = 1 ]; then INSTANCE=production; return 0; fi

  INSTANCE=demo
  itext ""
  idimtext "A demo instance erases all its data every night and loads a fresh demo dataset."
  idimtext "It has no administrator account: visitors sign in with a public demo account."
  idimtext "Use a dedicated server or database: any data already in the database is erased."
  ask DEMO_LOGIN "Demo account username" "${HP_DEMO_LOGIN:-demo}" validate_username HP_DEMO_LOGIN
  ask DEMO_PASSWORD "Demo account password (public, shown on the sign-in page)" "${HP_DEMO_PASSWORD:-demo}" validate_env_value HP_DEMO_PASSWORD
  ask DEMO_RESET_TIME "Daily reset time (HH:MM, $(detect_timezone) time)" "${HP_DEMO_RESET_TIME:-03:00}" validate_time HP_DEMO_RESET_TIME
}

instance_label() {
  if [ "$INSTANCE" = demo ]; then printf 'Demo — reset every night at %s' "$DEMO_RESET_TIME"; else printf 'Production'; fi
}

configure_auto_update() {
  local default=n
  [ "${HP_AUTO_UPDATE:-0}" = 1 ] && default=y
  itext ""
  idimtext "Humble Planning can check for new releases every night and install patch releases"
  idimtext "(x.y.Z) by itself, after a database backup and with an automatic rollback on failure."
  if ask_yes_no "Enable automatic updates? (patch releases only, nightly, with automatic backup and rollback)" "$default"; then
    AUTO_UPDATE=1
  else
    AUTO_UPDATE=0
  fi
}

auto_update_label() {
  if [ "$AUTO_UPDATE" = 1 ]; then printf 'Enabled — patch releases, nightly'; else printf 'Disabled'; fi
}

https_label() {
  if [ "$CADDY" = 1 ]; then
    case "$TLS_MODE:$CLOUDFLARE" in
      acme:1) printf "Let's Encrypt via Cloudflare DNS" ;;
      acme:0) printf "Let's Encrypt (HTTP challenge)" ;;
      *) printf 'None — plain HTTP on port %s' "$HTTP_PORT" ;;
    esac
  else
    printf 'Handled by your own reverse proxy'
  fi
}

load_existing_config() {
  APP_URL=$(env_get APP_BASE_URL)
  parse_url "$APP_URL" || die "APP_BASE_URL in $INSTALL_DIR/.env is not a valid URL: $APP_URL" nolog
  local profiles
  profiles=$(env_get COMPOSE_PROFILES)
  [[ ",$profiles," == *,db,* ]] && DB_MODE=builtin || DB_MODE=external
  [[ ",$profiles," == *,caddy,* ]] && CADDY=1 || CADDY=0
  # Behind the Cloudflare proxy: TRUSTED_PROXY without Caddy (or with a
  # Caddyfile older than v1.0.0), client_ip_headers in the Caddyfile otherwise.
  [ "$(env_get TRUSTED_PROXY)" = cloudflare ] && CF_PROXY=1 || CF_PROXY=0
  APP_PORT=$(env_get HP_APP_PORT); APP_PORT=${APP_PORT:-3000}
  SOCKET_PORT=$(env_get HP_SOCKET_PORT); SOCKET_PORT=${SOCKET_PORT:-3001}
  HTTP_PORT=$(env_get HP_HTTP_PORT); HTTP_PORT=${HTTP_PORT:-80}
  HTTPS_PORT=$(env_get HP_HTTPS_PORT); HTTPS_PORT=${HTTPS_PORT:-443}
  APP_REPO=$(env_get HUMBLE_IMAGE) CADDY_REPO=$(env_get HUMBLE_CADDY_IMAGE) APP_VERSION=$(env_get HUMBLE_VERSION)
  if [ -f /etc/systemd/system/humble-planning-update.timer ] || [ -f /etc/cron.d/humble-planning-update ]; then AUTO_UPDATE=1; fi
  # The type of an existing installation is never changed.
  if [ "$(env_get DEMO_MODE)" = true ]; then
    INSTANCE=demo
    DEMO_LOGIN=$(env_get DEMO_LOGIN) DEMO_PASSWORD=$(env_get DEMO_PASSWORD) DEMO_RESET_TIME=$(env_get DEMO_RESET_TIME)
    DEMO_LOGIN=${DEMO_LOGIN:-demo} DEMO_PASSWORD=${DEMO_PASSWORD:-demo} DEMO_RESET_TIME=${DEMO_RESET_TIME:-03:00}
  else
    INSTANCE=production
  fi
  if [ -n "${HP_INSTANCE:-}" ] && [ "$HP_INSTANCE" != "$INSTANCE" ]; then
    warn "HP_INSTANCE=$HP_INSTANCE ignored: this installation stays a $INSTANCE instance."
  fi
  TLS_MODE=none CLOUDFLARE=0
  if [ "$CADDY" = 1 ] && [ -f "$INSTALL_DIR/Caddyfile" ]; then
    if grep -qE '^:[0-9]+ \{' "$INSTALL_DIR/Caddyfile"; then TLS_MODE=http; else TLS_MODE=acme; fi
    if grep -q 'dns cloudflare' "$INSTALL_DIR/Caddyfile"; then CLOUDFLARE=1; fi
    if caddyfile_reads_cf_ip; then CF_PROXY=1; fi
    # Kept when an outdated Caddyfile is generated again (prepare_files)
    ACME_EMAIL=$(sed -n 's/^[[:space:]]*email[[:space:]]\{1,\}\([^[:space:]]\{1,\}\).*/\1/p' "$INSTALL_DIR/Caddyfile" | sed -n 1p)
  fi
  return 0
}

# Does the Caddyfile resolve the visitor address from CF-Connecting-IP (on
# connections from Cloudflare only)? Caddyfiles older than v1.0.0 do not.
caddyfile_reads_cf_ip() {
  grep -qiE '^[[:space:]]*client_ip_headers[[:space:]]+cf-connecting-ip' "$INSTALL_DIR/Caddyfile"
}

configure() {
  step "Configuration"
  local default_dir=${HP_INSTALL_DIR:-/opt/humble-planning}

  if existing_install "$default_dir"; then
    INSTALL_DIR=$default_dir
    ok "Existing installation found in $INSTALL_DIR"
    if [ "$INTERACTIVE" = 1 ] && [ "$ASSUME_YES" != 1 ]; then
      ask_yes_no "Update it (new images, database migrations, restart)? Your data and settings are kept." y ||
        die "Nothing changed. To install another instance, set HP_INSTALL_DIR to another directory." nolog
    elif [ "${HP_UPDATE:-1}" != 1 ]; then
      die "An installation already exists in $INSTALL_DIR and HP_UPDATE=0." nolog
    fi
    MODE=update
    load_existing_config
  else
    ask APP_URL "Public URL of Humble Planning (e.g. https://planning.example.com)" "${HP_URL:-}" validate_url HP_URL
    APP_URL=${APP_URL%/}
    parse_url "$APP_URL"
    APP_URL="$URL_SCHEME://$URL_HOST${URL_PORT:+:$URL_PORT}"

    ask INSTALL_DIR "Installation directory" "$default_dir" validate_dir HP_INSTALL_DIR
    INSTALL_DIR=${INSTALL_DIR%/}
    if existing_install "$INSTALL_DIR"; then
      ok "Existing installation found in $INSTALL_DIR: switching to update mode"
      MODE=update
      load_existing_config
    fi
  fi

  if [ "$MODE" = install ]; then
    configure_instance

    itext ""
    local db_default=1 db_choice
    case "${HP_DB_MODE:-builtin}" in
      builtin|local) ;;
      external) db_default=2 ;;
      *) die "Invalid HP_DB_MODE \"$HP_DB_MODE\": use builtin or external." nolog ;;
    esac
    ask_choice db_choice "Database" "$db_default" \
      "Built-in PostgreSQL 18 container (recommended)" \
      "External PostgreSQL server (16 or later)"
    if [ "$db_choice" = 2 ]; then DB_MODE=external; ask_external_db; else DB_MODE=builtin; fi

    configure_caddy
    configure_cloudflare_proxy
    configure_auto_update

    # HP_IMAGE / HP_CADDY_IMAGE are repositories; a tag given there is accepted too.
    APP_REPO=${HP_IMAGE:-$DEFAULT_IMAGE_REPO} CADDY_REPO=${HP_CADDY_IMAGE:-$DEFAULT_CADDY_IMAGE_REPO}
    APP_VERSION=${HP_VERSION:-}
    if [[ ${APP_REPO##*/} == *:* ]]; then APP_VERSION=${APP_VERSION:-${APP_REPO##*:}}; APP_REPO=${APP_REPO%:*}; fi
    if [[ ${CADDY_REPO##*/} == *:* ]]; then CADDY_REPO=${CADDY_REPO%:*}; fi
    APP_VERSION=${APP_VERSION#v}
    choose_port APP_PORT "web application" "${HP_APP_PORT:-3000}" HP_APP_PORT
    choose_port SOCKET_PORT "Socket.io server" "${HP_SOCKET_PORT:-3001}" HP_SOCKET_PORT
    HTTP_PORT=${HTTP_PORT:-${HP_HTTP_PORT:-80}} HTTPS_PORT=${HTTPS_PORT:-${HP_HTTPS_PORT:-443}}
  fi
  APP_REPO=${APP_REPO:-$DEFAULT_IMAGE_REPO} CADDY_REPO=${CADDY_REPO:-$DEFAULT_CADDY_IMAGE_REPO}
  if [ -n "${HP_BUILD_SOURCE:-}" ]; then APP_REPO=humble-planning CADDY_REPO=humble-planning-caddy; fi

  local db_label proxy_label
  if [ "$DB_MODE" = builtin ]; then
    db_label="Built-in PostgreSQL 18 container"
  elif [ -n "$DB_HOST" ]; then
    db_label="External: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
  elif ! is_placeholder "$(env_get DATABASE_URL)"; then
    db_label="External: $(env_get DATABASE_URL | sed -E 's|^[a-z]+://([^:@]*)(:[^@]*)?@([^?]*).*|\1@\3|')"
  else
    db_label="External PostgreSQL server (connection to be tested)"
  fi
  if [ "$CADDY" = 1 ]; then proxy_label="Caddy (ports $HTTP_PORT/$HTTPS_PORT)"; else proxy_label="None — app on 127.0.0.1:$APP_PORT, Socket.io on 127.0.0.1:$SOCKET_PORT"; fi
  [ "$CF_PROXY" = 1 ] && proxy_label+=", behind the Cloudflare proxy"

  [ "$INTERACTIVE" = 1 ] && text ""
  box "Summary" \
    "${DIM}Mode         ${RESET} $( [ "$MODE" = update ] && echo "Update of the existing installation" || echo "New installation")" \
    "${DIM}Instance     ${RESET} $(instance_label)" \
    "${DIM}Public URL   ${RESET} $APP_URL" \
    "${DIM}Directory    ${RESET} $INSTALL_DIR" \
    "${DIM}Database     ${RESET} $db_label" \
    "${DIM}Reverse proxy${RESET} $proxy_label" \
    "${DIM}HTTPS        ${RESET} $(https_label)" \
    "${DIM}Auto updates ${RESET} $(auto_update_label)" \
    "${DIM}Image        ${RESET} $APP_REPO:${APP_VERSION:-latest release}"
  itext ""
  confirm "Proceed with the $( [ "$MODE" = update ] && echo update || echo installation)?" || die "Installation cancelled." nolog
}

# ─── Step 3: Docker ──────────────────────────────────────────────────────────

install_docker_packages() {
  local pkg
  for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg -s "$pkg" >/dev/null 2>&1; then apt-get -o DPkg::Lock::Timeout=300 remove -y "$pkg"; fi
  done
  apt-get -o DPkg::Lock::Timeout=300 update
  apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL --retry 3 "https://download.docker.com/linux/$DOCKER_DIST/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$DOCKER_DIST
Suites: $DOCKER_SUITE
Components: stable
Architectures: $ARCH
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get -o DPkg::Lock::Timeout=300 update
  apt-get -o DPkg::Lock::Timeout=300 install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

start_docker_daemon() {
  if has_systemd; then
    systemctl enable --now containerd.service docker.service
  else
    nohup dockerd >/var/log/dockerd.log 2>&1 &
  fi
  local i
  for ((i = 0; i < 60; i++)); do
    docker_ok && return 0
    sleep 1
  done
  echo "The Docker daemon did not start within 60 seconds (see /var/log/dockerd.log)."
  return 1
}

setup_docker() {
  step "Docker Engine"
  if [ "$DOCKER_READY" = 1 ]; then
    ok "Docker $DOCKER_VERSION and Compose $COMPOSE_VERSION already installed"
  else
    run_task "Installing Docker Engine and Docker Compose from download.docker.com" install_docker_packages
    detect_docker
    [ "$DOCKER_READY" = 1 ] || die "Docker was installed but does not meet the requirements (Docker ${DOCKER_VERSION:-?}, Compose ${COMPOSE_VERSION:-?})."
  fi
  if docker_ok; then
    ok "Docker daemon is running"
  else
    has_systemd || warn "systemd not available: starting dockerd in the background (log: /var/log/dockerd.log)"
    run_task "Starting the Docker daemon" start_docker_daemon
    detect_docker
    sub_info "Docker $DOCKER_VERSION, Compose $COMPOSE_VERSION"
  fi
}

# ─── Step 4: files ───────────────────────────────────────────────────────────

nginx_example() {
  cat <<EOF
# Humble Planning behind nginx — Socket.io must go to the socket container.
server {
    listen 443 ssl http2;
    server_name $URL_HOST;
    # ssl_certificate     /etc/ssl/…/fullchain.pem;
    # ssl_certificate_key /etc/ssl/…/privkey.pem;

    client_max_body_size 500M;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:$SOCKET_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
    }

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
    }
}
EOF
}

# Renders deploy/Caddyfile into the installation directory for the current settings.
write_caddyfile() {
  local template blocks="" site=":80"
  template=$(mktemp)
  fetch_file deploy/Caddyfile "$template" || die "Could not download the Caddyfile template." nolog
  if [ "$TLS_MODE" = acme ]; then
    site=$URL_HOST; blocks=https
    [ -n "$ACME_EMAIL" ] && blocks+=",acme_email"
    [ "$CLOUDFLARE" = 1 ] && blocks+=",cloudflare"
  fi
  [ "$CF_PROXY" = 1 ] && blocks+=",cloudflare_proxy"
  if [[ ",$blocks," == *,acme_email,* || ",$blocks," == *,cloudflare_proxy,* ]]; then blocks+=",global"; fi
  render_caddyfile "$blocks" "$site" "$ACME_EMAIL" "$template" >"$INSTALL_DIR/Caddyfile"
  chmod 0644 "$INSTALL_DIR/Caddyfile"
  rm -f "$template"
}

install_wrapper() {
  local tmp
  tmp=$(mktemp)
  fetch_file deploy/humble-planning "$tmp" || die "Could not download the humble-planning command." nolog
  install -m 0755 "$tmp" "$WRAPPER_PATH"
  rm -f "$tmp"
  printf '# Humble Planning — written by install.sh\nHUMBLE_INSTALL_DIR=%s\n' "$INSTALL_DIR" >"$WRAPPER_CONFIG"
  chmod 0644 "$WRAPPER_CONFIG"
}

prepare_files() {
  step "Installation files"
  install -d -m 0750 "$INSTALL_DIR"

  local compose_tmp
  compose_tmp=$(mktemp)
  fetch_file deploy/docker-compose.yml "$compose_tmp" || die "Could not download docker-compose.yml from $REPO_RAW." nolog
  if [ -f "$INSTALL_DIR/docker-compose.yml" ] && ! cmp -s "$compose_tmp" "$INSTALL_DIR/docker-compose.yml"; then
    cp -p "$INSTALL_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml.bak-$(date +%Y%m%d%H%M%S)"
    install -m 0640 "$compose_tmp" "$INSTALL_DIR/docker-compose.yml"
    ok "docker-compose.yml updated (previous version saved as .bak)"
  elif [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    ok "docker-compose.yml is up to date"
  else
    install -m 0640 "$compose_tmp" "$INSTALL_DIR/docker-compose.yml"
    ok "docker-compose.yml"
  fi
  rm -f "$compose_tmp"

  if [ "$CADDY" = 1 ]; then
    if [ "$MODE" = update ] && [ -f "$INSTALL_DIR/Caddyfile" ] && { [ "$CF_PROXY" = 0 ] || caddyfile_reads_cf_ip; }; then
      ok "Caddyfile kept"
    elif [ "$MODE" = update ] && [ -f "$INSTALL_DIR/Caddyfile" ]; then
      # Behind the Cloudflare proxy, a Caddyfile older than v1.0.0 lets the
      # application trust CF-Connecting-IP from anyone (TRUSTED_PROXY).
      cp -p "$INSTALL_DIR/Caddyfile" "$INSTALL_DIR/Caddyfile.bak-$(date +%Y%m%d%H%M%S)"
      write_caddyfile
      CADDYFILE_UPDATED=1
      ok "Caddyfile updated: CF-Connecting-IP is now only accepted from Cloudflare (previous version saved as .bak)"
    else
      write_caddyfile
      ok "Caddyfile for $( [ "$TLS_MODE" = acme ] && echo "$URL_HOST" || echo "plain HTTP on port $HTTP_PORT")"
    fi
  fi

  # .env — settings of this run, secrets only when missing
  local fresh=set
  [ "$MODE" = update ] && fresh=keep
  local profiles=""
  [ "$DB_MODE" = builtin ] && profiles=db
  [ "$CADDY" = 1 ] && profiles=${profiles:+$profiles,}caddy
  local tz
  tz=$(detect_timezone)

  env_plan "Docker Compose" COMPOSE_PROJECT_NAME "$PROJECT_NAME" keep
  env_plan "Docker Compose" COMPOSE_PROFILES "$profiles" "$fresh"
  env_plan "Docker Compose" HUMBLE_IMAGE "$APP_REPO" set
  env_plan "Docker Compose" HUMBLE_CADDY_IMAGE "$CADDY_REPO" set
  env_plan "Docker Compose" HP_APP_PORT "$APP_PORT" "$fresh"
  env_plan "Docker Compose" HP_SOCKET_PORT "$SOCKET_PORT" "$fresh"
  if [ "$CADDY" = 1 ]; then
    env_plan "Docker Compose" HP_HTTP_PORT "$HTTP_PORT" "$fresh"
    env_plan "Docker Compose" HP_HTTPS_PORT "$HTTPS_PORT" "$fresh"
  fi

  env_plan "Application" NODE_ENV production keep
  env_plan "Application" PORT 3000 keep
  env_plan "Application" SOCKET_PORT 3001 keep
  env_plan "Application" APP_BASE_URL "$APP_URL" "$fresh"
  env_plan "Application" BETTER_AUTH_URL "$APP_URL" "$fresh"
  env_plan "Application" TIMEZONE "$tz" keep
  env_plan "Application" UPLOAD_DIR ./uploads keep
  # Caddy compresses the responses: Node.js can skip its own gzip.
  [ "$CADDY" = 1 ] && env_plan "Application" TRUST_PROXY_COMPRESSION true keep
  # Client address: X-Real-IP from the reverse proxy. Caddy resolves it itself
  # (CF-Connecting-IP from Cloudflare's addresses only); behind the Cloudflare
  # proxy without Caddy, the application reads CF-Connecting-IP.
  if [ "$CADDY" = 1 ]; then
    env_unset TRUSTED_PROXY
  elif [ "$CF_PROXY" = 1 ]; then
    env_plan "Application" TRUSTED_PROXY cloudflare "$fresh"
  fi

  if [ "$INSTANCE" = demo ]; then
    env_plan "Demo" DEMO_MODE true set
    env_plan "Demo" DEMO_LOGIN "$DEMO_LOGIN" "$fresh"
    env_plan "Demo" DEMO_PASSWORD "$DEMO_PASSWORD" "$fresh"
    env_plan "Demo" DEMO_RESET_TIME "$DEMO_RESET_TIME" "$fresh"
  fi

  if [ "$DB_MODE" = builtin ]; then
    # POSTGRES_* set up the postgres image: its superuser stays in the db
    # container. The application connects as the user of DATABASE_URL, a
    # role without superuser rights that owns the database (db_app_role).
    local su_user su_pass pg_db app_user
    su_user=$(env_get POSTGRES_USER); su_user=${su_user:-postgres}
    pg_db=$(env_get POSTGRES_DB); pg_db=${pg_db:-${HP_DB_NAME:-humble_planning}}
    su_pass=$(env_get POSTGRES_PASSWORD)
    is_placeholder "$su_pass" && su_pass=$(gen_secret)
    validate_identifier "$su_user" >/dev/null || die "Invalid PostgreSQL superuser name: $su_user" nolog
    validate_identifier "$pg_db" >/dev/null || die "Invalid database name: $pg_db" nolog
    env_plan "Database" POSTGRES_USER "$su_user" keep
    env_plan "Database" POSTGRES_PASSWORD "$su_pass" keep
    env_plan "Database" POSTGRES_DB "$pg_db" keep
    if is_placeholder "$(env_get DATABASE_URL)"; then
      app_user=${HP_DB_USER:-humbleplanning}
      validate_identifier "$app_user" >/dev/null || die "Invalid database user name: $app_user" nolog
      [ "$app_user" != "$su_user" ] || die "HP_DB_USER cannot be $su_user, the PostgreSQL superuser: choose another user name." nolog
      env_plan "Database" DATABASE_URL "postgresql://$app_user:$(gen_secret)@db:5432/$pg_db" keep
    fi
  fi

  local key had_backup_key
  had_backup_key=$(env_get BACKUP_ENCRYPTION_KEY)
  for key in BETTER_AUTH_SECRET SOCKET_SECRET BACKUP_ENCRYPTION_KEY ALTCHA_HMAC_SECRET ALTCHA_HMAC_KEY_SECRET; do
    env_plan "Secrets" "$key" "$(gen_secret)" keep
  done
  if is_placeholder "$had_backup_key"; then BACKUP_KEY_NEW=${ENV_VALUE[BACKUP_ENCRYPTION_KEY]:-}; fi

  env_plan "Updates" HUMBLE_UPDATE_REPO "${HP_UPDATE_REPO:-$DEFAULT_UPDATE_REPO}" keep
  [ -n "${HP_UPDATE_SOURCE:-}" ] && env_plan "Updates" HUMBLE_UPDATE_SOURCE "$HP_UPDATE_SOURCE" set
  [ "${HP_PULL:-1}" = 0 ] && env_plan "Updates" HUMBLE_PULL 0 set
  [ -n "${HP_BUILD_SOURCE:-}" ] && env_plan "Updates" HUMBLE_BUILD_SOURCE "$HP_BUILD_SOURCE" set

  if [ "$CADDY" = 1 ] && [ "$CLOUDFLARE" = 1 ] && [ "$MODE" = install ]; then
    env_plan "Reverse proxy" CLOUDFLARE_API_TOKEN "$CF_TOKEN" set
  fi

  local had_env=0
  [ -f "$INSTALL_DIR/.env" ] && had_env=1
  env_commit
  chown root:root "$INSTALL_DIR/.env"
  if [ "$had_env" = 0 ]; then
    ok ".env with newly generated secrets (mode 600)"
  elif [ "$ENV_CHANGED" = 1 ]; then
    ok ".env completed (existing values and secrets kept, mode 600)"
  else
    ok ".env kept unchanged (mode 600)"
  fi

  if [ "$CADDY" = 0 ]; then
    nginx_example >"$INSTALL_DIR/nginx-example.conf"
    chmod 0644 "$INSTALL_DIR/nginx-example.conf"
  fi
  install_wrapper
  ok "Management command: $WRAPPER_PATH (humble-planning help)"
}

# ─── Step 5: images ──────────────────────────────────────────────────────────

image_exists() { docker image inspect "$1" >/dev/null 2>&1; }
image_version() { docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$1" 2>/dev/null || true; }

build_app_image() { # → humble-planning:<version>
  local src=$HP_BUILD_SOURCE v=$APP_VERSION
  if [ -z "$v" ] && [ -d "$src" ]; then v=$(SOURCE_DIR=$src source_version); fi
  docker build --pull -t "$APP_REPO:build" --build-arg "APP_VERSION=${v:-0.0.0}" "$src"
  v=${v:-$(image_version "$APP_REPO:build")}
  docker tag "$APP_REPO:build" "$APP_REPO:${v:-0.0.0}"
  docker rmi "$APP_REPO:build" >/dev/null
}

build_caddy_image() {
  if [ -n "${HP_BUILD_SOURCE:-}" ] && [ -d "$HP_BUILD_SOURCE" ]; then
    docker build --pull -t "$CADDY_IMAGE" "$HP_BUILD_SOURCE/deploy/caddy"
  elif [ -n "${HP_BUILD_SOURCE:-}" ]; then
    docker build --pull -t "$CADDY_IMAGE" "${HP_BUILD_SOURCE%%#*}#${HP_BUILD_SOURCE#*#}:deploy/caddy"
  elif [ -n "$SOURCE_DIR" ]; then
    docker build --pull -t "$CADDY_IMAGE" "$SOURCE_DIR/deploy/caddy"
  else
    curl -fsSL --retry 3 "$REPO_RAW/deploy/caddy/Dockerfile" | docker build --pull -t "$CADDY_IMAGE" -
  fi
}

# The latest release: pull :latest, read its version label, tag it with it.
pull_latest() {
  docker pull "$APP_REPO:latest"
  local v
  v=$(image_version "$APP_REPO:latest")
  [ -n "$v" ] || { echo "$APP_REPO:latest has no version label: set HP_VERSION."; return 1; }
  docker tag "$APP_REPO:latest" "$APP_REPO:$v"
}

images() {
  step "Container images"
  if [ -n "${HP_IMAGE_ARCHIVE:-}" ]; then
    [ -f "$HP_IMAGE_ARCHIVE" ] || die "HP_IMAGE_ARCHIVE not found: $HP_IMAGE_ARCHIVE" nolog
    run_task "Loading images from $(basename "$HP_IMAGE_ARCHIVE")" docker load -i "$HP_IMAGE_ARCHIVE"
  fi

  if [ -n "${HP_BUILD_SOURCE:-}" ]; then
    info "Building from $HP_BUILD_SOURCE: this can take 5 to 15 minutes."
    run_task "Building the application image" build_app_image
    if [ -z "$APP_VERSION" ]; then
      [ -d "$HP_BUILD_SOURCE" ] && APP_VERSION=$(SOURCE_DIR=$HP_BUILD_SOURCE source_version)
      [ -n "$APP_VERSION" ] || APP_VERSION=$(docker images --format '{{.Tag}}' "$APP_REPO" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n1 || true)
    fi
  elif [ "${HP_PULL:-1}" != 0 ] && [ -z "$APP_VERSION" ]; then
    run_task "Downloading the latest release of $APP_REPO" pull_latest
    APP_VERSION=$(image_version "$APP_REPO:latest")
  elif [ "${HP_PULL:-1}" != 0 ]; then
    if ! spin "Downloading $APP_REPO:$APP_VERSION" docker pull "$APP_REPO:$APP_VERSION"; then
      if image_exists "$APP_REPO:$APP_VERSION"; then
        sub_warn "Download failed: using the local copy of $APP_REPO:$APP_VERSION"
      else
        die "Could not download $APP_REPO:$APP_VERSION. Check HP_VERSION / HP_IMAGE, or set HP_BUILD_SOURCE to build from source."
      fi
    fi
  else
    [ -n "$APP_VERSION" ] || die "HP_VERSION is required with HP_PULL=0." nolog
    image_exists "$APP_REPO:$APP_VERSION" || die "Image $APP_REPO:$APP_VERSION not found locally and HP_PULL=0." nolog
    ok "Using the local image $APP_REPO:$APP_VERSION"
  fi
  [[ $APP_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Could not determine the version to install (got \"$APP_VERSION\"): set HP_VERSION." nolog
  APP_IMAGE="$APP_REPO:$APP_VERSION"
  CADDY_IMAGE="$CADDY_REPO:$APP_VERSION"
  sub_info "Humble Planning version $APP_VERSION"

  if [ "$CADDY" = 1 ]; then
    if [ -n "${HP_BUILD_SOURCE:-}" ]; then
      run_task "Building the Caddy image (with the Cloudflare DNS module)" build_caddy_image
    elif [ "${HP_PULL:-1}" != 0 ] && spin "Downloading $CADDY_IMAGE" docker pull "$CADDY_IMAGE"; then
      :
    elif image_exists "$CADDY_IMAGE"; then
      ok "Using the local image $CADDY_IMAGE"
    else
      sub_warn "$CADDY_IMAGE is not available: building it on this server"
      run_task "Building the Caddy image (with the Cloudflare DNS module)" build_caddy_image
    fi
  fi

  env_plan "Updates" HUMBLE_VERSION "$APP_VERSION" set
  env_commit
}

# ─── Step 6: database ────────────────────────────────────────────────────────

PROV_OUT=""

# prov <args…> — provision.ts in a one-off app container. Protocol lines go to
# $PROV_OUT, diagnostics to the log. Secrets are passed on stdin.
# Inside spin, SPIN_INPUT is already on stdin; elsewhere PROV_INPUT is piped in.
prov() {
  if [ -n "${PROV_INPUT+x}" ]; then
    printf '%s\n' "$PROV_INPUT" | compose run --rm -T --no-deps app provision "$@" >"$PROV_OUT" 2>>"$LOG_FILE"
  elif [ -n "${SPIN_INPUT+x}" ]; then
    compose run --rm -T --no-deps app provision "$@" >"$PROV_OUT" 2>>"$LOG_FILE"
  else
    compose run --rm -T --no-deps app provision "$@" >"$PROV_OUT" 2>>"$LOG_FILE" </dev/null
  fi
}

# Same, before the stack exists (external database check, input via SPIN_INPUT).
prov_image() {
  docker run --rm -i --add-host host.docker.internal:host-gateway "$APP_IMAGE" provision "$@" >"$PROV_OUT" 2>>"$LOG_FILE"
}

# render_prov [sub] — prints the protocol lines of the last call
render_prov() {
  local prefix=${1:-sub} tag msg
  while IFS=$'\t' read -r tag msg; do
    case "$tag" in
      OK) "${prefix}_ok" "$msg" ;;
      INFO) "${prefix}_info" "$msg" ;;
      WARN) "${prefix}_warn" "$msg" ;;
      ERR) "${prefix}_bad" "$msg" ;;
    esac
  done <"$PROV_OUT"
}

# Built-in database: the application connects as the user of DATABASE_URL, a
# dedicated role that owns its database and the public schema, but is neither
# a superuser nor allowed to create roles: an SQL injection cannot run
# programs (COPY … FROM PROGRAM) or read files on the server. CREATEDB is kept
# for the in-app import, which restores a backup into a temporary database.
# Runs at every installation and update once the db container is healthy (an
# init script would only run on an empty volume): creates the role when
# missing, then applies its attributes, its password from .env and the
# ownerships again. The SQL, password included, reaches psql through stdin.
db_app_role() {
  local url su_user app_user app_pass app_db rc=0
  local re='^postgres(ql)?://([A-Za-z_][A-Za-z0-9_]{0,62}):([A-Za-z0-9._~-]+)@db:5432/([A-Za-z_][A-Za-z0-9_]{0,62})$'
  url=$(env_get DATABASE_URL) su_user=$(env_get POSTGRES_USER)
  if [[ ! $url =~ $re ]]; then
    warn "DATABASE_URL was changed by hand: its user was not checked (it must own the database and not be a superuser)"
    return 0
  fi
  app_user=${BASH_REMATCH[2]} app_pass=${BASH_REMATCH[3]} app_db=${BASH_REMATCH[4]}
  if [ "$app_user" = "${su_user:-postgres}" ]; then
    warn "The application connects to PostgreSQL as its superuser \"$app_user\" (installation made before v1.0.0)."
    sub_info "It keeps working, but an SQL injection could then run commands in the db container."
    sub_info "New installations use a dedicated user: see \"Database user\" in docs/installation.md."
    return 0
  fi
  SPIN_INPUT=$(db_app_role_sql "$app_user" "$app_pass" "$app_db")
  spin "Database user $app_user (owner of $app_db, not a superuser)" db_psql || rc=$?
  unset SPIN_INPUT
  [ "$rc" = 0 ] || die "Could not set up the database user $app_user."
}

# psql script of db_app_role. The values were checked there: identifiers, and
# a password made of URL-safe characters (no quotes, no backslashes).
db_app_role_sql() {
  cat <<EOF
\set app_user '$1'
\set app_password '$2'
\set app_db '$3'
SELECT format('CREATE ROLE %I', :'app_user')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEROLE CREATEDB NOREPLICATION NOBYPASSRLS PASSWORD %L',
              :'app_user', :'app_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'app_user')
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'app_db') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'app_db', :'app_user') \gexec
\connect :app_db
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user') \gexec
EOF
}

# psql as the PostgreSQL superuser in the db container (local socket, no
# password), script on stdin.
db_psql() {
  # shellcheck disable=SC2016 # expanded by the shell of the container
  compose exec -T db sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres'
}

database() {
  step "Database"
  if [ "$DB_MODE" = external ]; then
    if [ "$MODE" = update ] && ! is_placeholder "$(env_get DATABASE_URL)"; then
      ok "External database (configured in .env)"
    else
      # Resumed installation whose database was never validated
      [ -n "$DB_HOST" ] || ask_external_db
      while :; do
        local url rc=0
        url=$(external_db_url)
        SPIN_INPUT=$url
        spin "Testing the connection to $DB_HOST:$DB_PORT" prov_image check-db --url-stdin || rc=$?
        unset SPIN_INPUT
        render_prov
        if [ "$rc" = 0 ]; then
          env_plan "Database" DATABASE_URL "$url" set
          env_commit
          sub_ok "DATABASE_URL saved in .env"
          break
        fi
        [ "$INTERACTIVE" = 1 ] || die "Cannot use the external database (see the message above)." nolog
        ask_yes_no "Do you want to enter the database settings again?" y || die "Installation aborted: the database is not reachable." nolog
        ask_external_db
      done
    fi
  else
    run_task "Starting the PostgreSQL container" compose up -d --wait --wait-timeout 180 db
    db_app_role
  fi

  local rc=0
  spin "Applying database migrations" prov migrate || rc=$?
  render_prov
  [ "$rc" = 0 ] || die "Database migration failed."
  if [ "$INSTANCE" = demo ]; then demo_data; fi
}

# Demo instance: erases the database and loads the demo dataset. A database
# holding data that the demo did not create is only erased once confirmed.
demo_data() {
  local rc=0
  # Update: start_stack starts the application again, with fresh caches.
  if [ "$MODE" = update ]; then spin "Stopping the application" compose stop app || true; fi
  spin "Loading the demo data" prov demo-reset || rc=$?
  render_prov
  if [ "$rc" = 3 ]; then
    if [ "$INTERACTIVE" = 1 ]; then
      ask_yes_no "The database already contains data that was not created by the demo. Erase everything and load the demo data?" n ||
        die "Installation aborted: the database was left unchanged." nolog
    elif [ "${HP_DEMO_FORCE_RESET:-0}" != 1 ]; then
      die "The database already contains data that was not created by the demo: set HP_DEMO_FORCE_RESET=1 to erase it and load the demo data." nolog
    fi
    rc=0
    spin "Erasing the database and loading the demo data" prov demo-reset --force || rc=$?
    render_prov
  fi
  [ "$rc" = 0 ] || die "Could not load the demo data."
}

# ─── Step 7: administrator ───────────────────────────────────────────────────

administrator() {
  step "Administrator account"
  if [ "$INSTANCE" = demo ]; then
    ok "Demo instance: no administrator account (visitors use the demo account)"
    return 0
  fi
  local rc=0 admins additional=""
  prov admin-status || die "Could not read the user accounts."
  admins=$(sed -n 's/^DATA\tadmin=//p' "$PROV_OUT" | paste -sd, - | sed 's/,/, /g')
  if [ -n "$admins" ]; then
    if [ "$MODE" = update ] || [ "$INTERACTIVE" = 0 ]; then
      ok "Administrator account already present ($admins): step skipped"
      return 0
    fi
    if ask_yes_no "An administrator account already exists ($admins). Skip this step?" y; then
      ok "Administrator account kept ($admins)"
      return 0
    fi
    additional=--additional
  fi

  if [ "$INTERACTIVE" = 0 ]; then
    ask ADMIN_USER "Administrator username" "${HP_ADMIN_USER:-admin}" validate_username HP_ADMIN_USER
    [ -n "${HP_ADMIN_PASSWORD:-}" ] || die "HP_ADMIN_PASSWORD is required to create the administrator account." nolog
    PROV_INPUT=$HP_ADMIN_PASSWORD
    prov create-admin "$ADMIN_USER" $additional || rc=$?
    unset PROV_INPUT
    if [ "$rc" != 0 ]; then
      render_prov sub
      die "Could not create the administrator account (see the messages above)." nolog
    fi
    ok "Administrator account \"$ADMIN_USER\" created"
    ADMIN_CREATED=1
    return 0
  fi

  prov password-rules || die "Could not read the password policy."
  local rules=() rule
  while IFS= read -r rule; do rules+=("$rule"); done < <(sed -n 's/^INFO\t//p' "$PROV_OUT")

  while :; do
    ask ADMIN_USER "Administrator username" "${HP_ADMIN_USER:-admin}" validate_username
    dimtext "Password requirements:"
    for rule in "${rules[@]}"; do dimtext "  • $rule"; done
    local pw pw2
    while :; do
      read_secret pw "Password"
      rc=0
      PROV_INPUT=$pw
      prov check-password || rc=$?
      unset PROV_INPUT
      if [ "$rc" != 0 ]; then
        bad "This password does not meet the requirements:"
        sed -n 's/^ERR\t//p' "$PROV_OUT" | while IFS= read -r line; do sub_bad "$line"; done
        continue
      fi
      read_secret pw2 "Confirm the password"
      if [ "$pw" != "$pw2" ]; then
        bad "The two passwords do not match. Please try again."
        continue
      fi
      break
    done
    rc=0
    SPIN_INPUT=$pw
    spin "Creating the administrator account" prov create-admin "$ADMIN_USER" $additional || rc=$?
    unset SPIN_INPUT
    pw="" pw2=""
    render_prov sub
    if [ "$rc" = 0 ]; then ADMIN_CREATED=1; break; fi
    [ "$rc" = 3 ] && grep -q 'already taken' "$PROV_OUT" && continue
    die "Could not create the administrator account." nolog
  done
}

# ─── Step 8: start ───────────────────────────────────────────────────────────

wait_http() {
  local url=$1 timeout=$2 i code
  for ((i = 0; i < timeout; i += 2)); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)
    [ "$code" = 200 ] && return 0
    sleep 2
  done
  echo "No HTTP 200 from $url after ${timeout}s (last status: ${code:-none})."
  return 1
}

start_stack() {
  step "Starting Humble Planning"
  info "The first start can take a minute or two."
  run_task "Starting the containers" compose up -d --wait --wait-timeout 300
  # A running Caddy keeps the configuration it loaded: apply the updated Caddyfile.
  if [ "$CADDYFILE_UPDATED" = 1 ]; then
    run_task "Reloading the Caddy configuration" compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  fi
  run_task "Checking the web application" wait_http "http://127.0.0.1:$APP_PORT/login" 120
  if [ "$MODE" = install ] && [ "$AUTO_UPDATE" = 1 ]; then
    "$WRAPPER_PATH" auto-update on || { warn "Automatic updates could not be enabled: run 'humble-planning auto-update on' later."; AUTO_UPDATE=0; }
  fi
  if [ "$CADDY" = 1 ]; then
    if [ "$TLS_MODE" = http ]; then
      run_task "Checking Caddy (HTTP)" wait_http "http://127.0.0.1:$HTTP_PORT/login" 60
    else
      sub_info "Caddy is requesting the certificate for $URL_HOST (needs DNS pointing to this server)"
    fi
  fi
}

# ─── Update to a newer release (existing installations) ─────────────────────

check_new_release() {
  printf '\n'
  text "${BOLD}Checking for a newer release${RESET}"
  local args=()
  { [ "$INTERACTIVE" = 0 ] || [ "$ASSUME_YES" = 1 ]; } && args+=(--yes)
  if "$WRAPPER_PATH" update "${args[@]}"; then
    APP_VERSION=$(env_get HUMBLE_VERSION)
  else
    warn "The update did not complete (see the messages above): Humble Planning keeps running v$(env_get HUMBLE_VERSION)."
  fi
}

# ─── Summary ─────────────────────────────────────────────────────────────────

summary() {
  local account_lines=()
  if [ "$INSTANCE" = demo ]; then
    account_lines=("${DIM}Demo account ${RESET} $DEMO_LOGIN / $DEMO_PASSWORD" "${DIM}Data reset   ${RESET} every night at $DEMO_RESET_TIME")
  elif [ "$ADMIN_CREATED" = 1 ]; then
    account_lines=("${DIM}Administrator${RESET} $ADMIN_USER")
  else
    account_lines=("${DIM}Administrator${RESET} (existing account)")
  fi
  printf '\n'
  BOX_COLOR=$GREEN box "Humble Planning is ready" \
    "${DIM}URL          ${RESET} ${BOLD}$APP_URL${RESET}" \
    "${account_lines[@]}" \
    "${DIM}HTTPS        ${RESET} $(https_label)" \
    "${DIM}Version      ${RESET} v${APP_VERSION:-?}" \
    "${DIM}Auto updates ${RESET} $( [ "$AUTO_UPDATE" = 1 ] && echo "Enabled — patch releases, nightly" || echo "Disabled — enable with: humble-planning auto-update on")" \
    "${DIM}Directory    ${RESET} $INSTALL_DIR" \
    "${DIM}Install log  ${RESET} $LOG_FILE" \
    "" \
    "${BOLD}Useful commands${RESET}" \
    "  humble-planning status     state of the containers" \
    "  humble-planning logs       follow the logs (app, socket, db, caddy)" \
    "  humble-planning restart    restart Humble Planning" \
    "  humble-planning update     update to the latest release (backup + rollback)"

  if [ -n "$BACKUP_KEY_NEW" ]; then
    printf '\n'
    BOX_COLOR=$YELLOW box "Backup encryption key — shown only once" \
      "${BOLD}$BACKUP_KEY_NEW${RESET}" \
      "" \
      "Store this key in a password manager. It is also in $INSTALL_DIR/.env," \
      "but without it, backups made by Humble Planning cannot be restored."
  fi

  if [ "$CADDY" = 0 ]; then
    printf '\n'
    text "${BOLD}What is left to do${RESET}"
    text "  1. Point the DNS record of ${URL_HOST} to this server."
    text "  2. Serve ${APP_URL} over HTTPS with your reverse proxy:"
    text "     /socket.io/* → 127.0.0.1:$SOCKET_PORT, everything else → 127.0.0.1:$APP_PORT"
    text "  3. nginx example (also saved in $INSTALL_DIR/nginx-example.conf):"
    printf '\n'
    nginx_example | sed "s/^/     ${DIM}│${RESET} /"
    if [ "$CF_PROXY" = 1 ]; then
      printf '\n'
      text "  4. Behind the Cloudflare proxy, the application trusts CF-Connecting-IP (TRUSTED_PROXY=cloudflare):"
      text "     only accept connections from Cloudflare's addresses (https://www.cloudflare.com/ips) on this server."
    fi
  elif [ "$TLS_MODE" = acme ]; then
    printf '\n'
    text "${BOLD}Before the first visit${RESET}"
    if [ "$CLOUDFLARE" = 1 ]; then
      text "  • Point the DNS record of ${URL_HOST} to this server (the certificate uses the Cloudflare DNS challenge)."
    else
      text "  • Point the DNS record of ${URL_HOST} to this server and open ports 80 and 443."
    fi
    text "  • Certificate progress: humble-planning logs caddy"
  else
    printf '\n'
    warn "Humble Planning is served over plain HTTP: use HTTPS for a production server."
  fi
  printf '\n'
}

# ─── Main ────────────────────────────────────────────────────────────────────

usage() {
  sed -n '3,/^set -Eeuo/p' "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null | sed -e '/^set -Eeuo/d' -e 's/^# \{0,1\}//' ||
    echo "Usage: sudo bash install.sh [--yes] [--non-interactive]"
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -y|--yes) ASSUME_YES=1 ;;
      --non-interactive) HP_NONINTERACTIVE=1 ;;
      -h|--help) usage; exit 0 ;;
      *) printf 'Unknown option: %s (see --help)\n' "$1"; exit 2 ;;
    esac
    shift
  done

  if [ "${HP_NONINTERACTIVE:-0}" = 1 ]; then
    INTERACTIVE=0
  elif ! { : </dev/tty; } 2>/dev/null; then
    printf 'No terminal available for the questions. Run with HP_NONINTERACTIVE=1 and the HP_* variables (see --help).\n' >&2
    exit 2
  fi

  install -d -m 0755 "$(dirname "$LOG_FILE")" 2>/dev/null || true
  if ! touch "$LOG_FILE" 2>/dev/null; then LOG_FILE=/tmp/humble-planning-install.log; touch "$LOG_FILE"; fi
  chmod 600 "$LOG_FILE" 2>/dev/null || true
  log "===== Humble Planning installer started (interactive=$INTERACTIVE)"
  TMP_DIR=$(mktemp -d)
  PROV_OUT="$TMP_DIR/provision.out"

  detect_source_dir
  local version label=installer
  version=$(source_version)
  [ -n "$version" ] && label="v$version"
  print_banner "$label"

  printf '\n'
  text "This script installs Humble Planning with Docker on this server:"
  text "  ${ACCENT}•${RESET} Docker Engine and Docker Compose, if they are not installed yet"
  text "  ${ACCENT}•${RESET} the Humble Planning containers: web app, real-time server, PostgreSQL"
  text "  ${ACCENT}•${RESET} optionally Caddy, a reverse proxy with automatic HTTPS"
  dimtext "Estimated time: 5 to 10 minutes. Detailed log: $LOG_FILE"
  printf '\n'
  confirm "Continue?" || die "Installation cancelled." nolog

  check_system
  configure
  setup_docker
  prepare_files
  images
  database
  administrator
  start_stack
  if [ "$MODE" = update ]; then check_new_release; fi
  summary
  log "===== Installation finished successfully"
}

# Run main unless the file is sourced (tests source it to reuse the helpers).
if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
  main "$@"
fi
