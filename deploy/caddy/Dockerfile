# syntax=docker/dockerfile:1.7
#
# Caddy with the Cloudflare DNS module (github.com/caddy-dns/cloudflare), used
# by the Humble Planning stack for the ACME DNS-01 challenge.
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
