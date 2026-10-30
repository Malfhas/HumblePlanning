import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import packageJson from "./package.json";

// next-intl without locale routing: the plugin aliases `next-intl/config` to
// this file (Turbopack in dev, Webpack at build: `next build --webpack`).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Enables Next.js gzip compression for ALL responses
  // (static + API routes). Important for the large JSON payloads
  // of /api/tasks (schedule over several months). If Next.js is served
  // behind a reverse proxy (Caddy/Nginx) that already compresses, this flag
  // stays idempotent: Next.js delegates in that case.
  compress: true,
  // React Compiler: automatic memoization, removes the need for
  // manual useMemo/useCallback in most cases. Targets the planning
  // grid (components with many store-dependent re-renders).
  // Next.js 16 wraps the compiler via SWC and only analyzes the relevant
  // files (no general build cost). babel-plugin-react-compiler
  // is required as a devDep.
  reactCompiler: true,
  // Next.js 16.3+: `next dev` writes no generated file at the project root.
  agentRules: false,
  serverExternalPackages: [
    "pdfkit",
    "sharp",
    "exceljs",
    "ical-generator",
    "isomorphic-dompurify",
    "jsdom",
    "css-tree",
  ],
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
  // Dev only: allows HMR and /_next resources when the app is
  // opened via the APP_BASE_URL host (e.g. IP 192.168.x.x to test from
  // a phone). Next.js 16 blocks any host other than localhost by default.
  allowedDevOrigins: [new URL(process.env.APP_BASE_URL || "http://localhost:3000").hostname],
  // Do not advertise the framework (makes instances harder to fingerprint).
  poweredByHeader: false,
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-DNS-Prefetch-Control", value: "on" },
      // A private scheduling tool: keep every page, API response and file out of
      // search engines and AI crawlers (robots.txt only stops crawling, this
      // header also stops indexing of URLs found elsewhere).
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
      // microphone=(self): AI chat voice dictation (Whisper, local transcription).
      { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
      // Content-Security-Policy: restricts content sources.
      // 'unsafe-inline' for script-src is required by Next.js
      // (inline hydration scripts); 'unsafe-eval' by React DevTools/HMR in dev.
      // Allowed connect-src:
      //   - https://router.project-osrm.org      : task tooltip → travel distance
      //   - https://api-adresse.data.gouv.fr     : address autocomplete (data.gouv.fr)
      //   - https://photon.komoot.io             : fallback address autocomplete (Komoot/OSM)
      //   - wss: / ws:                           : real-time Socket.io
      // Captcha: Cloudflare Turnstile (challenges.cloudflare.com) +
      //          Google reCAPTCHA (www.google.com + www.gstatic.com)
      // Map tiles (ArcGIS, IGN geopf, unpkg/leaflet) are covered by img-src https:.
      // AI chat dictation (Whisper in the browser): 'wasm-unsafe-eval' to
      // compile the onnxruntime-web WebAssembly (self-served), and the
      // model download from huggingface.co, redirected to its CDN
      // (*.hf.co, observed: us.aws.cdn.hf.co).
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://www.google.com https://www.gstatic.com${isProd ? "" : " 'unsafe-eval'"}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          // Socket.io: in production, the client hits `window.location.origin`
          // (already covered by 'self', the reverse proxy routes /socket.io/).
          // localhost:3001 / 127.0.0.1:3001 are only used in local dev or with
          // NEXT_PUBLIC_SOCKET_URL pointing at port 3001 (test build without a proxy).
          "connect-src 'self' http://localhost:3001 http://127.0.0.1:3001 https://router.project-osrm.org https://api-adresse.data.gouv.fr https://photon.komoot.io https://challenges.cloudflare.com https://huggingface.co https://*.hf.co wss: ws:",
          // ALTCHA spreads the proof-of-work over several Web Workers created
          // dynamically from blob URLs. Without this directive, the
          // script-src fallback blocks the workers.
          "worker-src 'self' blob:",
          "frame-src 'self' https://challenges.cloudflare.com https://www.google.com",
          "frame-ancestors 'self'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
    ];
    // HSTS: prod only (otherwise it blocks HTTP localhost:3000).
    if (isProd) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload",
      });
    }
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
