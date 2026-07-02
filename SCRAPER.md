# Web Scraper Documentation

This document provides details on the web scraper functionality used to pre-fill registry item details from a given URL.

## Overview

The web scraper is exposed via the `POST /api/registry/scrape` API endpoint. It is an admin-only feature designed to simplify adding new items to the registry by automatically fetching metadata from a product page.

The backend uses the `node-html-parser` library, which is a lightweight and robust tool to parse HTML and extract metadata from a webpage. It primarily looks for Open Graph tags (`og:title`, `og:description`, `og:image`), but will fall back to other metadata like standard meta tags.

## Architecture and Extraction Workflow

The scraper follows a strict sequence to ensure security and reliability when fetching external resources:

1.  **Request Initiation:** An administrator provides a URL to the "Add Item" form in the admin dashboard, sending a POST request to `/api/registry/scrape`.
2.  **URL Validation & SSRF Protection:** The system validates the URL format. Crucially, before any request is made, a Server-Side Request Forgery (SSRF) guard clause verifies the target hostname. It resolves the hostname to an IP address and blocks any requests to private or restricted network ranges.
3.  **Content Fetching:** Once the URL is deemed safe, a `fetch` request is executed with standard user-agent headers to mimic a normal browser visit and avoid basic bot protections.
4.  **HTML Parsing:** The HTML response body is parsed using `node-html-parser`.
5.  **Data Extraction:** The parsed DOM is queried for relevant product data (Title, Description, Image) using Open Graph tags. Vendor-specific fallbacks (like Amazon image selectors) are executed if standard tags are missing.
6.  **Response Generation:** The extracted metadata is structured into a standard response object and wrapped by the API middleware before being returned to the client to pre-fill the form.

## Known Issues and Limitations

The scraper's effectiveness is highly dependent on the target website's structure and policies. Here are some known quirks:

*   **Costco:** Links from Costco do not work. Costco's website has measures in place to block web scrapers.
*   **Amazon:** The scraper generally works for Amazon product pages, but it often fails to extract the main product image. This is a common issue as the primary image is often loaded dynamically or is not specified in standard metadata tags.
*   **Dynamic Websites:** The scraper may struggle with websites that are heavily reliant on client-side JavaScript to render their content, as `open-graph-scraper` does not execute JavaScript.
*   **Inconsistent Results:** The quality and availability of scraped data can be inconsistent across different retail websites. Manual entry or correction is often required.

## Areas for Improvement

The current implementation is basic and could be significantly improved. Here are some potential enhancements:

*   **More Robust Scraping:** Instead of relying solely on `open-graph-scraper`, a more advanced solution could be implemented.
    *   **Puppeteer/Playwright:** Use a headless browser like Puppeteer or Playwright to render the page, including JavaScript. This would allow for scraping of dynamically loaded content and could solve the issues with Amazon images.
    *   **Custom Scrapers:** For popular sites like Amazon, a custom scraper could be written to target the specific HTML structure of their product pages, yielding more reliable results.
*   **Error Handling:** The API could provide more specific error messages to the client, explaining why a scrape failed (e.g., "Blocked by website," "No metadata found").
*   **Image Fallback:** If an image cannot be scraped, the backend could attempt to find a fallback, such as a high-quality favicon or a placeholder image.
