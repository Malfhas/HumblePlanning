# syntax=docker/dockerfile:1.7
#
# Caddy for the Humble Planning stack:
#   - the Cloudflare DNS module (github.com/caddy-dns/cloudflare), used for the
#     ACME DNS-01 challenge;
#   - /etc/caddy/cloudflare-ips.caddy, Cloudflare's IP ranges as trusted
#     proxies, imported by the Caddyfile when the site is served through the
#     Cloudflare proxy (CF-Connecting-IP is only read from these addresses).
# Check: docker run --rm <image> caddy list-modules | grep dns.providers.cloudflare

ARG CADDY_VERSION=2.11.7

# Cross-compiles on the build platform (Go needs no emulation for multi-arch).
FROM --platform=$BUILDPLATFORM caddy:${CADDY_VERSION}-builder AS builder
ARG TARGETOS
ARG TARGETARCH
ARG CADDY_DNS_CLOUDFLARE_VERSION=v0.2.4
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    xcaddy build --with github.com/caddy-dns/cloudflare@${CADDY_DNS_CLOUDFLARE_VERSION}

FROM caddy:${CADDY_VERSION}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# A static list, refreshed with each release, rather than a module fetching it
# at runtime: no outgoing request, nothing to fail when Caddy starts. The
# workflow .github/workflows/cloudflare-ips.yml compares it with Cloudflare's
# list every week and opens an issue when it changes. To refresh it by hand:
# curl -fsS https://www.cloudflare.com/ips-v4 https://www.cloudflare.com/ips-v6
# (the list changes rarely; a missing range only makes the visitors behind it
# appear with a Cloudflare address, it never trusts an unknown sender).
COPY <<"EOF" /etc/caddy/cloudflare-ips.caddy
# Cloudflare's IP ranges (https://www.cloudflare.com/ips/), checked on 2026-10-31.
trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
EOF
