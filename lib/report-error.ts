/**
 * Sends a failed page to /api/system-errors.
 *
 * Runs in the browser, from inside an error boundary — which is the one place
 * in the app where throwing again is least forgivable. Everything is
 * swallowed, and `keepalive` lets the report survive the user immediately
 * navigating away from the page that just broke.
 *
 * What this can see depends on where the failure was. A client-side render
 * crash arrives with a real message and stack, and those never reach the
 * server log any other way. A server component failure in production arrives
 * with only Next's digest, which is still what ties this row to the server
 * log line that has the real trace.
 */
export async function reportClientError(
  route: string,
  error: Error & { digest?: string },
): Promise<void> {
  try {
    await fetch("/api/system-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        route: route || "unknown",
        message: error.message?.slice(0, 2_000),
        stack: error.stack?.slice(0, 20_000),
        digest: error.digest,
      }),
    });
  } catch {
    // The page is already showing a failure; there is nothing useful to do
    // with a failure to report it.
  }
}
