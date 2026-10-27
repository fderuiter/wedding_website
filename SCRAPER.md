# Web Scraper Documentation

This document provides details on the web scraper functionality used to pre-fill registry item details from a given URL.

## Overview

The web scraper is exposed via the `POST /api/registry/scrape` API endpoint. It is an admin-only feature designed to simplify adding new items to the registry by automatically fetching metadata and pricing from a product page.

The backend uses `node-html-parser` to parse HTML and extract product information. Rather than relying solely on Open Graph meta tags, the scraper employs a multi-tier extraction pipeline including JSON-LD structured data parsing, Open Graph and Twitter meta tags, domain-specific vendor selectors for major retailers (Amazon, Target, Costco), and site favicon resolution.

## Architecture and Extraction Workflow

The scraper follows a strict sequence to ensure security, accuracy, and reliability when fetching external resources:

1.  **Request Initiation:** An administrator submits a product URL in the registry admin dashboard, sending a POST request to `/api/registry/scrape`.
2.  **URL Validation & SSRF Protection:** The input URL is validated using standard schema validation. Before initiating an HTTP connection, a Server-Side Request Forgery (SSRF) guard clause verifies the hostname by resolving it to an IP address and blocking requests targeting private, local, or restricted network ranges.
3.  **Content Fetching:** A fetch request is dispatched with customized browser user-agent and accept headers to emulate a standard web browser. Requests are bound by a strict timeout (via `AbortController`).
4.  **HTML Parsing:** The response HTML body is parsed into a virtual DOM using `node-html-parser`.
5.  **Data Extraction Pipeline:**
    *   **JSON-LD Structured Data Parsing:** The DOM is searched for `<script type="application/ld+json">` elements. JSON payload trees are parsed safely to extract structured `Product` properties including `name`, `description`, `image` (URL and caption/alt text), and price from `offers` or `priceSpecification`.
    *   **Meta Tag Extraction:** Fallback product metadata is retrieved from Open Graph tags (`og:title`, `og:description`, `og:image`, `og:image:alt`, `og:price:amount`), Twitter card tags (`twitter:image`, `twitter:data1`), and standard `<title>` elements.
    *   **Vendor-Specific Selectors:** Custom DOM selector heuristics target retailer-specific markup for popular store domains:
        *   **Amazon (`amazon.com`):** Targets `#productTitle`/`#title` for title, `#feature-bullets`/`#productDescription` for description, `.a-price .a-offscreen` for price, and `#imgTagWrapperId img`/`#landingImage`/`#main-image` for product images.
        *   **Target (`target.com`):** Targets `h1[data-test="product-title"]`/`h1.pdp-title` for title, `div[data-test="item-details-description"]`/`#pdp-tab-description` for description, and `div[data-test="product-image"] img`/`img[data-test="current-image"]` for images.
        *   **Costco (`costco.com`):** Targets `h1[data-qa="product-title"]`/`.product-h1`/`h1.product-title` for title, `#product-description`/`.product-info-description` for description, and `#initialLoadedImage`/`.product-image-canvas img`/`img[data-qa="product-image"]` for images.
    *   **Multi-Tier Price Extraction:** Price is evaluated hierarchically from JSON-LD offers/specifications, `og:price:amount`, `product:price:amount`, Twitter price data, or vendor DOM price elements.
    *   **Favicon Fallback:** Site favicons are extracted from HTML `<link rel="icon">`, `<link rel="shortcut icon">`, or `<link rel="apple-touch-icon">` tags. If no link tag exists, it checks `/favicon.ico` or defaults to Google's favicon service (`https://www.google.com/s2/favicons?domain=...`).
6.  **Response Generation:** The final normalized metadata (`name`, `description`, `price`, `imageUrl`, `imageAlt`, `vendorUrl`, `quantity`, `faviconUrl`) is returned as a JSON response.

## Error Handling & Error Domains

When scraping fails or is rejected by external retailers, the API throws structured `ApiError` exceptions classified into distinct error domains:

*   **`BLOCKED_BY_VENDOR`:** Returned when a retailer's site blocks the scraper with HTTP status codes `403 Forbidden`, `401 Unauthorized`, or `429 Too Many Requests`. This occurs when cloud Web Application Firewalls (WAF) or anti-bot measures (such as Cloudflare or Akamai) reject automated user-agents.
*   **`URL_NOT_FOUND`:** Returned when the requested product page responds with HTTP status codes `404 Not Found` or `410 Gone`.
*   **`NETWORK_TIMEOUT`:** Returned when the network fetch fails, connections are refused, or the request exceeds the server timeout cutoff.

## Known Issues and Limitations

*   **Anti-Bot Blocking:** Retailers frequently employ sophisticated anti-bot protections (e.g., Akamai Bot Manager, Cloudflare Bot Management). Scrapes to sites like Costco, Target, or Amazon may periodically fail with `BLOCKED_BY_VENDOR`.
*   **Client-Side Rendering:** `node-html-parser` parses static HTML retrieved from the fetch response. Sites that require client-side JavaScript execution (Single Page Applications) to load product details or images may yield incomplete metadata if the information is not present in initial HTML or JSON-LD tags.
*   **Inconsistent Vendor Layouts:** Retailers frequently update their DOM class names and layout structures. While JSON-LD and Open Graph tags mitigate this, vendor-specific selectors may require updates if retailer markup changes significantly.

## Areas for Improvement

*   **Headless Browser Rendering:** Integrating browser automation engines like Puppeteer or Playwright for fallback rendering could allow executing client-side JavaScript and bypassing basic client-side bot detection.
*   **Proxy Management:** Implementing residential proxy rotation could help mitigate `BLOCKED_BY_VENDOR` errors caused by IP-based rate limits on retailer sites.
*   **Expanded Vendor Heuristics:** Adding custom selectors and JSON-LD edge case handlers for additional popular registry retailers (e.g., Williams Sonoma, Crate & Barrel, Macy's).
