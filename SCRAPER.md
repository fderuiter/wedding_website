# Web Scraper Documentation

This document describes the runtime architecture, endpoints, security controls, selector precedence, and error domains for the product metadata scraper used to pre-fill gift registry items.

## Overview

The registry scraper provides two **Admin-only** endpoints backed by `node-html-parser` and the SSRF-hardened `safeFetch` client:

1. **Single-URL Scrape (`POST /api/registry/scrape`)**: Implemented in [src/features/registry/api/scrape.ts](src/features/registry/api/scrape.ts) ([src/app/api/registry/scrape/route.ts](src/app/api/registry/scrape/route.ts)) for interactive single-item metadata lookup in the admin registry modal and Admin Content Hub photo import.
2. **Batch URL Scrape (`POST /api/registry/scrape/batch`)**: Implemented in [src/features/registry/api/batch-scrape.ts](src/features/registry/api/batch-scrape.ts) ([src/app/api/registry/scrape/batch/route.ts](src/app/api/registry/scrape/batch/route.ts)) for bulk importing up to 20 product URLs concurrently.

Both endpoints require an authenticated administrator session (`isProtectedRoute` -> `Admin-only`) and enforce `isFeatureEnabled('registry', config.modules)`, returning HTTP `404` (`"Feature 'registry' is disabled"`) whenever the `registry` module toggle is disabled.

---

## Endpoints, Limits, and Timeouts

| Property | Single Scrape (`POST /api/registry/scrape`) | Batch Scrape (`POST /api/registry/scrape/batch`) |
| --- | --- | --- |
| **Handler** | [src/features/registry/api/scrape.ts](src/features/registry/api/scrape.ts) | [src/features/registry/api/batch-scrape.ts](src/features/registry/api/batch-scrape.ts) |
| **Request Schema** | `ScrapeUrlSchema` (`{ url: string }`) in [src/utils/validation.ts](src/utils/validation.ts) | `BatchScrapeUrlsSchema` (`{ urls: string[] }`, **min `1` / max `20` URLs**, max `2,000` chars each) in [src/features/registry/schemas.ts](src/features/registry/schemas.ts) |
| **Concurrency** | `1` URL per request | Worker pool of **`5` concurrent scrapes** (`limit = 5` in `runWithConcurrency`) |
| **Timeouts** | **`4,500 ms`** `AbortController` timeout (`timeoutMs = 4500`) active through full body stream completion | **`10,000 ms`** per-URL timeout (`10000`) bounded by a **`15,000 ms`** master batch `AbortController` (`15000`), both active through full body stream completion |
| **Max HTML Payload** | **`1 MiB` (`1,048,576 bytes`)** (`MAX_SCRAPE_HTML_BYTES` via `readBoundedResponseText` in [src/utils/boundedStream.ts](src/utils/boundedStream.ts)) enforced before DOM parsing | **`1 MiB` (`1,048,576 bytes`)** per URL (`MAX_SCRAPE_HTML_BYTES`) enforced before DOM parsing |
| **Success Response** | HTTP `200` `ScrapedProductData` JSON object | HTTP `200` `{ success: true, results, total, successful, failed }` |
| **Failure Behavior** | Throws HTTP `404` when `registry` is disabled, HTTP `400` on invalid URL / SSRF block, or HTTP `422` `ApiError` with `{ errorDomain }` | Throws HTTP `404` when `registry` is disabled or HTTP `400` if the `{ urls }` envelope fails schema validation (e.g., empty array or `> 20` URLs); individual URL failures **never abort the batch** and populate `{ success: false, error, errorDomain }` per item |

---

## SSRF Protection & Redirect Validation

All outbound requests execute through `safeFetch` ([src/utils/safeFetch.ts](src/utils/safeFetch.ts)) with browser-like `User-Agent` and `Accept` headers:

1. **Protocol Allowlist**: Only `http:` and `https:` URLs are permitted ([src/utils/validation.ts](src/utils/validation.ts) and [src/utils/safeFetch.ts](src/utils/safeFetch.ts)).
2. **Canonical Binary CIDR Resolution & Private Range Blocking**: Before opening a socket, `validateAndResolveHost` ([src/utils/ssrf.ts](src/utils/ssrf.ts)) canonicalizes IPv4 and IPv6 literals into 32-bit and 128-bit `BigInt` integers (`parseIPv4ToBigInt`, `parseIPv6ToBigInt`) and resolves hostnames with `{ all: true }`, blocking loopback (`127.0.0.0/8`, `::1/128`), private RFC 1918 / IPv6 Unique Local (`fc00::/7`), link-local / cloud metadata (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), benchmarking (`198.18.0.0/15`, `2001:2::/48`), documentation, multicast/reserved, NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`), and IPv4-transitional IPv6 ranges (`::/96`, `::ffff:0:0/96`, `2002::/16`, `2001::/32`).
3. **DNS-Rebinding Pinning**: `safeFetch` attaches a per-request `undici` `Agent` dispatcher (`createPinnedDispatcher`) whose custom `lookup` callback pins the TCP/TLS connection to the exact validated IP address so an attacker cannot rebind DNS between validation and socket connection.
4. **Validated Redirect Hops**: Redirects are followed manually (`redirect: 'manual'`) for up to **`5` hops** (`maxRedirects = 5`), re-running full URL and SSRF IP validation on every `Location` target before following the hop.

---

## Metadata Extraction Precedence

Once `node-html-parser` parses the HTML document inside `scrapeProductUrl` ([src/features/registry/api/scrape.ts](src/features/registry/api/scrape.ts)) via `extractProductMetadataFromHtml` ([src/features/registry/api/scrape.ts](src/features/registry/api/scrape.ts)), fields are resolved in strict priority order. Across `name`, `description`, and `imageUrl`, **JSON-LD structured data is evaluated first, Open Graph / Twitter meta tags take priority second, and vendor-specific DOM selectors act only as third-tier fallbacks**:

1. **`name` (`string`)**:
   - JSON-LD `Product.name` (`<script type="application/ld+json">`, traversing nested `@graph` arrays and matching `@type` containing `Product`)
   - Open Graph `<meta property="og:title">`
   - Vendor title selector (`#productTitle, #title` on `amazon.com` and `*.amazon.com`; `h1[data-test="product-title"], h1.pdp-title` on `target.com`; `h1[data-qa="product-title"], .product-h1, h1.product-title` on `costco.com` — see [src/features/registry/api/scrape.ts](src/features/registry/api/scrape.ts))
   - Document `<title>` tag (defaulting to `''` if absent)
2. **`description` (`string`)**:
   - JSON-LD `Product.description`
   - Open Graph `<meta property="og:description">`
   - Vendor description selector (`#feature-bullets, #productDescription` on `amazon.com` and `*.amazon.com`; `div[data-test="item-details-description"], #pdp-tab-description` on `target.com`; `#product-description, .product-info-description` on `costco.com`)
3. **`imageUrl` (`string`)**:
   - JSON-LD `Product.image` (string, array, or `ImageObject.url` / `contentUrl`)
   - Open Graph `<meta property="og:image">`
   - Twitter card `<meta name="twitter:image">` (or `property="twitter:image"`)
   - Vendor image selector (`#imgTagWrapperId img, #landingImage, #main-image, img#landingImage` on `amazon.com` and `*.amazon.com`; `div[data-test="product-image"] img, img[data-test="current-image"], picture img` on `target.com`; `#initialLoadedImage, .product-image-canvas img, img[data-qa="product-image"]` on `costco.com`), resolved to an absolute URL against the scraped `url`
4. **`imageAlt` (`string | undefined`)**:
   - JSON-LD `ImageObject.caption` or `ImageObject.name`
   - Open Graph `<meta property="og:image:alt">`
   - Twitter card `<meta name="twitter:image:alt">`
   - Matched vendor `<img>` `alt` attribute (falling back to `name` when non-empty)
5. **`price` (`number | undefined`)**:
   - JSON-LD `Product.offers` (`price`, `lowPrice`, or nested `priceSpecification.price`), followed by top-level `Product.price` / `Product.lowPrice`
   - Open Graph `<meta property="og:price:amount">`
   - Product meta `<meta property="product:price:amount">`
   - Twitter card `<meta name="twitter:data1">`, evaluated **only** when `twitter:label1` contains `"price"` (case-insensitive)
   - Unconditional DOM fallback **`.a-price .a-offscreen`**: queried on **every** page regardless of hostname ([src/features/registry/api/scrape.ts](src/features/registry/api/scrape.ts)). No Target- or Costco-specific DOM price selectors exist; if none of the tiers yields a positive numeric value, `price` remains `undefined`.
6. **`faviconUrl` (`string`)**:
   - HTML `<link>` tag matching `rel~="icon"`, `rel="shortcut icon"`, or `rel="apple-touch-icon"` with a non-empty `href`, resolved relative to `url`
   - **Static `/favicon.ico` URL construction**: when no `<link>` icon tag is present, `extractProductMetadataFromHtml` ([src/features/registry/api/scrape.ts](src/features/registry/api/scrape.ts)) returns `new URL('/favicon.ico', url).toString()` directly **without** performing any network `HEAD`/`GET` probe (falling back to `https://www.google.com/s2/favicons?domain=<hostname>&sz=128` only if `new URL('/favicon.ico', url)` throws).
7. **`vendorUrl` & `quantity`**:
   - `vendorUrl` echoes the requested `url`, and `quantity` defaults to `1`.

---

## Error Handling & Error Domains

Scraper failures are categorized into four structured `BatchScrapeResultItem['errorDomain']` values ([src/features/registry/api/batch-scrape.ts](src/features/registry/api/batch-scrape.ts)) across [src/features/registry/api/scrape.ts](src/features/registry/api/scrape.ts) and [src/features/registry/api/batch-scrape.ts](src/features/registry/api/batch-scrape.ts):

* **`INVALID_URL`**: Returned per item in `POST /api/registry/scrape/batch` when an entry in `urls` is empty, fails `new URL()` parsing, or uses a protocol other than `http:` or `https:` ([src/features/registry/api/batch-scrape.ts](src/features/registry/api/batch-scrape.ts)). On single-URL `POST /api/registry/scrape`, malformed or non-HTTP(S) URLs are rejected upfront by `ScrapeUrlSchema` or `safeFetch` with **HTTP 400**.
* **`BLOCKED_BY_VENDOR`**: Returned when an upstream retailer responds with HTTP `401 Unauthorized`, `403 Forbidden`, or `429 Too Many Requests` (for example, Cloudflare or Akamai bot challenges). Single scrape throws **HTTP 422** with `details: { errorDomain: 'BLOCKED_BY_VENDOR' }`; batch scrape records `errorDomain: 'BLOCKED_BY_VENDOR'` on that item (`POST /api/registry/scrape/batch` also maps SSRF `Blocked: ...` rejections to `BLOCKED_BY_VENDOR` per item, whereas single scrape returns **HTTP 400**).
* **`URL_NOT_FOUND`**: Returned when the upstream product page responds with HTTP `404 Not Found` or `410 Gone` (HTTP 422 with `{ errorDomain: 'URL_NOT_FOUND' }` on single scrape; per-item `errorDomain: 'URL_NOT_FOUND'` on batch scrape).
* **`NETWORK_TIMEOUT`**: Returned when the upstream response returns any other non-2xx HTTP status, exceeds the `1 MiB` HTML byte limit (`MAX_SCRAPE_HTML_BYTES`), encounters a DNS/socket/TLS error, or aborts due to the `4,500 ms` single timeout, `10,000 ms` per-URL batch timeout, or `15,000 ms` master batch timeout across headers or body streaming (HTTP 422 with `{ errorDomain: 'NETWORK_TIMEOUT' }` on single scrape; per-item `errorDomain: 'NETWORK_TIMEOUT'` on batch scrape).

---

## Known Limitations

* **Anti-Bot Challenges**: Major retailers (Amazon, Target, Costco) periodically challenge automated server fetches with HTTP `403` or `429` (`BLOCKED_BY_VENDOR`).
* **Static HTML Parsing Only**: `node-html-parser` inspects the initial server-rendered HTML payload without executing client-side JavaScript. Single-page storefront apps that hydrate product metadata exclusively on the client may return partial fields unless JSON-LD or Open Graph tags are server-rendered.
* **Retailer Markup Drift & US Amazon Domain Scope**: Vendor fallback selectors cover US Amazon (`amazon.com` and `*.amazon.com`), Target (`target.com`), and Costco (`costco.com`) DOM conventions for title, description, and image, while DOM price fallback relies solely on `.a-price .a-offscreen` when JSON-LD and price meta tags are absent.
