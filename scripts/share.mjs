/**
 * Put the local app behind a temporary public URL, for testing.
 *
 * Run it with `npm run share`. It fetches `cloudflared` if you do not have it,
 * opens a Cloudflare quick tunnel (no account, no signup), points the app at
 * the URL that tunnel hands back, and starts the server. Ctrl+C closes the
 * tunnel and puts `.env` back exactly as it was.
 *
 * ## Why this is a script and not four commands
 *
 * Because the four commands have a trap in the middle that produces a silent
 * failure. NextAuth builds its callback URLs from `NEXTAUTH_URL`, so until that
 * matches the address the browser is actually on, every sign-in bounces back to
 * `/login` with no error and nothing in the log — the same symptom as a wrong
 * password. The tunnel's address is random and only exists once the tunnel is
 * already up, so the ordering is: tunnel first, rewrite `.env`, then start the
 * server. Get that order wrong and the site looks broken in a way that gives
 * you nothing to search for.
 *
 * ## What this is not
 *
 * Not a deployment. The URL dies with this process, the data is whatever is in
 * your local SQLite file, and every request is served by your own machine. For
 * anything lasting, see DEPLOY.md.
 */

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(ROOT, ".env");
const CACHE_DIR = join(ROOT, "node_modules", ".cache", "share");
const PORT = Number(process.env.PORT ?? 3000);

const RELEASES = "https://github.com/cloudflare/cloudflared/releases/latest/download";

/** The binary for this machine, and the name it is published under. */
function binaryFor() {
  const { platform, arch } = process;
  if (platform === "win32") {
    return { file: "cloudflared.exe", asset: `cloudflared-windows-${arch === "arm64" ? "arm64" : "amd64"}.exe` };
  }
  if (platform === "darwin") {
    // Published as a tarball rather than a bare binary, so Homebrew is the
    // sane route here and the download path below is not worth writing.
    return { file: "cloudflared", asset: null };
  }
  return { file: "cloudflared", asset: `cloudflared-linux-${arch === "arm64" ? "arm64" : "amd64"}` };
}

/** cloudflared from PATH if it is there, otherwise a cached download. */
async function ensureCloudflared() {
  // One command string rather than an args array: Node deprecates passing an
  // args array alongside `shell: true`, because the pieces are concatenated
  // rather than escaped. The shell is still needed so Windows resolves the
  // binary from PATH the way a terminal would.
  const onPath = spawnSync("cloudflared --version", { stdio: "ignore", shell: true });
  if (onPath.status === 0) return "cloudflared";

  const { file, asset } = binaryFor();
  const cached = join(CACHE_DIR, file);
  if (existsSync(cached)) return cached;

  if (!asset) {
    throw new Error(
      "cloudflared is not installed. On macOS: brew install cloudflared",
    );
  }

  console.log("Fetching cloudflared (one time, ~35 MB)…");
  await mkdir(CACHE_DIR, { recursive: true });

  const response = await fetch(`${RELEASES}/${asset}`, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download cloudflared — HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(cached));

  if (process.platform !== "win32") spawnSync("chmod", ["+x", cached]);
  return cached;
}

/** Refuse rather than fight over the port — a stale server would serve the old
 *  NEXTAUTH_URL and every sign-in would fail for no visible reason. */
async function requirePortFree() {
  try {
    const response = await fetch(`http://localhost:${PORT}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response) {
      throw new Error(
        `Something is already serving port ${PORT}. Stop it first — this script has to\n` +
          `  start the server itself, so it can set NEXTAUTH_URL to the tunnel's address.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("already serving")) throw error;
    // Anything else means nothing is listening, which is what we want.
  }
}

/**
 * Open a quick tunnel and resolve once it announces its address.
 *
 * cloudflared prints the URL to stderr, inside a box drawn in Unicode, so this
 * reads the stream rather than waiting for the process to exit.
 */
function openTunnel(bin) {
  const child = spawn(bin, ["tunnel", "--url", `http://localhost:${PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("The tunnel did not come up within 60 seconds."));
    }, 60_000);

    const read = (buffer) => {
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buffer));
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, url: match[0] });
    };

    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`cloudflared exited with code ${code}`));
    });
  });
}

/** Rewrite one key in .env, returning the file as it was. */
function setEnvValue(key, value) {
  const before = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const after = pattern.test(before)
    ? before.replace(pattern, line)
    : `${before}${before.endsWith("\n") || before === "" ? "" : "\n"}${line}\n`;
  writeFileSync(ENV_FILE, after);
  return before;
}

async function main() {
  await requirePortFree();

  const bin = await ensureCloudflared();
  console.log("Opening a tunnel…");
  const { child: tunnel, url } = await openTunnel(bin);

  // The trap, handled: the server has to boot already knowing its own address.
  const envBefore = setEnvValue("NEXTAUTH_URL", url);

  const server = spawn("npm run start", {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, NEXTAUTH_URL: url, PORT: String(PORT) },
  });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    console.log("\nClosing the tunnel and restoring .env…");
    writeFileSync(ENV_FILE, envBefore);
    tunnel.kill();
    server.kill();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  server.on("exit", shutdown);
  tunnel.on("exit", shutdown);

  setTimeout(() => {
    console.log(`
  ┌──────────────────────────────────────────────────────────────┐
     Public URL   ${url}

     Sign in      coachd@bwm.local        (owner)
                  tayyaba@bwm.local  claire@bwm.local
                  cam@bwm.local      cheryl@bwm.local
                  rajazain@bwm.local      (support)

     Password     ${process.env.SEED_PASSWORD ?? "bwm-change-me"}
                  — changed on first sign-in, 10 characters minimum

     This is your machine, served over a public address, holding
     your local SQLite data. Anyone with the link reaches the
     login page, and the default password above is published in
     this repository — so treat the link as temporary and share
     it narrowly. It dies when you press Ctrl+C.
  └──────────────────────────────────────────────────────────────┘
`);
  }, 3000);
}

main().catch(async (error) => {
  console.error(`\n${error.message}\n`);
  await rm(join(CACHE_DIR, "partial"), { force: true }).catch(() => {});
  process.exit(1);
});
