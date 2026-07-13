"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Global error caught:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ backgroundColor: "#111", color: "#eee", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", margin: 0, fontFamily: "sans-serif" }}>
        <div style={{ padding: "2rem", maxWidth: "400px", width: "100%", textAlign: "center", backgroundColor: "#222", borderRadius: "0.75rem", border: "1px solid #333" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", marginBottom: "1rem" }}>Critical Application Error</h1>
          <p style={{ color: "#aaa", marginBottom: "1.5rem" }}>
            A critical error occurred while rendering the application shell.
          </p>
          <button
            onClick={() => reset()}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", fontSize: "0.875rem", fontWeight: 500, backgroundColor: "#3b82f6", color: "#fff", height: "2.5rem", padding: "0 1rem", width: "100%", border: "none", cursor: "pointer" }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
