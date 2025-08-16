# Web Scraper Documentation

This document provides details on the web scraper functionality used to pre-fill registry item details from a given URL.

## Overview

The web scraper is exposed via the `POST /api/registry/scrape` API endpoint. It is an admin-only feature designed to simplify adding new items to the registry by automatically fetching metadata from a product page.

The backend uses the `metascraper` library, which is a powerful tool that bundles a number of other scrapers to extract metadata from a webpage. It primarily looks for Open Graph tags (`og:title`, `og:description`, `og:image`), but will fall back to other metadata like standard meta tags.

## How It Works

1.  An administrator provides a URL to the "Add Item" form in the admin dashboard.
2.  The frontend sends a request to the `POST /api/registry/scrape` endpoint with the URL in the request body.
3.  The backend fetches the content of the URL and processes it with `metascraper`.
4.  The extracted `name` (title), `description`, and `image` are returned to the client.
5.  The "Add Item" form is then pre-filled with this data.

## Known Issues and Limitations

The scraper's effectiveness is highly dependent on the target website's structure and policies. Here are some known quirks:

*   **Costco:** Links from Costco do not work. Costco's website has measures in place to block web scrapers.
*   **Amazon:** The scraper generally works for Amazon product pages, but it often fails to extract the main product image. This is a common issue as the primary image is often loaded dynamically or is not specified in standard metadata tags.
*   **Dynamic Websites:** The scraper may struggle with websites that are heavily reliant on client-side JavaScript to render their content, as `metascraper` does not execute JavaScript.
*   **Inconsistent Results:** The quality and availability of scraped data can be inconsistent across different retail websites. Manual entry or correction is often required.

## Areas for Improvement

The current implementation is basic and could be significantly improved. Here are some potential enhancements:

*   **More Robust Scraping:** Instead of relying solely on `metascraper`, a more advanced solution could be implemented.
    *   **Puppeteer/Playwright:** Use a headless browser like Puppeteer or Playwright to render the page, including JavaScript. This would allow for scraping of dynamically loaded content and could solve the issues with Amazon images.
    *   **Custom Scrapers:** For popular sites like Amazon, a custom scraper could be written to target the specific HTML structure of their product pages, yielding more reliable results.
*   **Error Handling:** The API could provide more specific error messages to the client, explaining why a scrape failed (e.g., "Blocked by website," "No metadata found").
*   **Image Fallback:** If an image cannot be scraped, the backend could attempt to find a fallback, such as a high-quality favicon or a placeholder image.
