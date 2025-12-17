## 2024-05-23 - Information Leakage in API Error Handling

**Vulnerability:** Several API endpoints (`/api/registry/contribute`, `/api/registry/add-item`, `/api/registry/scrape`) were catching exceptions and returning the raw `error.message` directly to the client in the JSON response.

**Learning:** This is a common pattern when developers want to "pass through" validation errors, but it inadvertently exposes internal system details (like database connection failures, SQL syntax errors, or library-specific stack traces) when unexpected errors occur.

**Prevention:** Always sanitize error messages at the API boundary. Log the full error details server-side for debugging, but return a generic, user-friendly message to the client (e.g., "An unexpected error occurred"). Only pass through specific, known error types that are safe for client consumption.
