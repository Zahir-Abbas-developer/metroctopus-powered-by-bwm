"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/report-error";

/**
 * The last boundary. Catches failures in the root layout itself, which the
 * per-route boundary sits inside of and therefore cannot catch.
 *
 * This one replaces the whole document, so it ships its own <html> and <body>
 * and cannot rely on any provider, font or stylesheet the layout would have
 * set up — the styles here are inline for exactly that reason. If the layout
 * is what broke, anything imported from it is suspect too.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    void reportClientError(
      typeof window === "undefined" ? "global" : window.location.pathname,
      error,
    );
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#FAFAF7",
          color: "#0C0C0A",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "420px", textAlign: "center" }}>
          <p
            style={{
              margin: 0,
              fontSize: "11px",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(12,12,10,0.45)",
            }}
          >
            Metroctopus
          </p>
          <h1 style={{ margin: "12px 0 0", fontSize: "22px", fontWeight: 700, letterSpacing: "-0.02em" }}>
            The app didn&rsquo;t start
          </h1>
          <p style={{ margin: "10px 0 0", fontSize: "14px", lineHeight: 1.6, color: "rgba(12,12,10,0.6)" }}>
            Something failed before any page could render. It has been logged.
          </p>
          {error.digest && (
            <p style={{ margin: "10px 0 0", fontSize: "12px", color: "rgba(12,12,10,0.4)" }}>
              Reference {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "20px",
              padding: "9px 18px",
              borderRadius: "999px",
              border: "1px solid #0C0C0A",
              background: "#0C0C0A",
              color: "#FAFAF7",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
