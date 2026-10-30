import type { MetadataRoute } from "next";

/**
 * robots.txt: a private scheduling tool has nothing to offer search engines or
 * AI crawlers. Indexing is also refused by the X-Robots-Tag header
 * (next.config.ts) and the robots meta tag (root layout).
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
