/**
 * A minimal Chrome DevTools Protocol client, in about 150 lines and with no
 * npm dependency.
 *
 * It exists because the HTTP smoke suite has a blind spot it cannot close: a
 * page whose server component renders fine but whose client component throws
 * on hydration returns HTTP 200 with perfectly healthy HTML, and the error
 * boundary only appears once React runs in a real browser. That is the shape
 * of most post-migration breakage — a field that moved, read during render —
 * and it is invisible to curl.
 *
 * Playwright or Puppeteer would do this in a line, at the cost of a dependency
 * and a browser download. Chrome is already on the machine and speaks a
 * protocol over a WebSocket, so this drives it directly. Node has no WebSocket
 * client, hence the frame encoding below; nothing else here is clever.
 *
 * Everything degrades gracefully: if Chrome is missing, the caller skips.
 */
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where to find a browser, in order of preference. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export function findBrowser() {
  return CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function frame(payload) {
  const data = Buffer.from(payload, "utf8");
  const mask = crypto.randomBytes(4);
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

class WS {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.handlers = [];
    socket.on("data", (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.drain();
    });
  }
  onMessage(fn) { this.handlers.push(fn); }
  drain() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f;
      let len = b1 & 0x7f, offset = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); offset = 10; }
      if (this.buf.length < offset + len) return;
      const payload = this.buf.subarray(offset, offset + len);
      this.buf = this.buf.subarray(offset + len);
      if (opcode === 0x8) { this.socket.end(); return; }
      if (opcode === 0x9) continue; // ping
      this.frag.push(Buffer.from(payload));
      if (fin) {
        const full = Buffer.concat(this.frag).toString("utf8");
        this.frag = [];
        if (full) for (const h of this.handlers) h(full);
      }
    }
  }
  send(text) { this.socket.write(frame(text)); }
}

export async function connect(wsUrl) {
  const u = new URL(wsUrl);
  const key = crypto.randomBytes(16).toString("base64");
  const socket = net.connect(Number(u.port), u.hostname);
  await new Promise((res, rej) => { socket.once("connect", res); socket.once("error", rej); });
  socket.write(
    `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\n` +
    `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  // Consume the 101 response, keeping any frame bytes that arrived with it.
  await new Promise((res, rej) => {
    let acc = Buffer.alloc(0);
    const onData = (chunk) => {
      acc = Buffer.concat([acc, chunk]);
      const end = acc.indexOf("\r\n\r\n");
      if (end === -1) return;
      const head = acc.subarray(0, end).toString();
      socket.removeListener("data", onData);
      if (!head.includes("101")) return rej(new Error("upgrade failed: " + head.split("\r\n")[0]));
      const rest = acc.subarray(end + 4);
      res();
      if (rest.length) socket.emit("data", rest);
    };
    socket.on("data", onData);
    socket.once("error", rej);
  });

  const ws = new WS(socket);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  const listeners = [];
  ws.onMessage((text) => {
    let msg; try { msg = JSON.parse(text); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
      for (const l of listeners) l(msg);
    }
  });
  return {
    events,
    on: (fn) => listeners.push(fn),
    close: () => socket.end(),
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        // Generous: in dev, the first visit to a route compiles it, and a
        // heavy page can take well over the default half-minute.
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); }
        }, Number(process.env.CDP_TIMEOUT_MS ?? 120000));
      });
    },
  };
}

export async function launch(port = 9333) {
  const browser = findBrowser();
  if (!browser) throw new Error("no Chrome-family browser found");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"));
  const child = spawn(browser, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--hide-scrollbars", "--mute-audio", "about:blank",
  ], { stdio: "ignore", detached: false });

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return { child, dir, ...(await res.json()), port };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error("Chrome did not start");
}
