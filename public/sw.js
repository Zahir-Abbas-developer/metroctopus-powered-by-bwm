/**
 * Agency OS service worker.
 *
 * Two jobs, and deliberately no third:
 *
 *   1. Receive pushes and show them, so an availability check reaches someone
 *      who doesn't have the app open. This is the whole reason it exists.
 *   2. Serve an offline page for navigations that fail, so a dropped
 *      connection shows something considered rather than the browser's error.
 *
 * It does NOT cache application routes. Every screen here is live data —
 * scores, queues, who is working right now — and a stale cached dashboard
 * would be worse than no dashboard. Getting that wrong is how a PWA starts
 * showing yesterday's numbers with no way to tell.
 */

const VERSION = "agency-os-v1";
const SHELL = [`/offline.html`, `/icons/icon-192.png`];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only page navigations, and only to fall back when the network is gone.
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() => caches.match("/offline.html").then((page) => page ?? Response.error())),
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Agency OS",
    body: "You have a new notification.",
    url: "/dashboard",
  };

  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag ?? "agency-os",
      // Availability checks stay on screen until acted on; everything else
      // behaves normally.
      requireInteraction: Boolean(payload.requireInteraction),
      data: { url: payload.url ?? "/dashboard" },
      vibrate: payload.requireInteraction ? [120, 60, 120] : undefined,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Reuse an open tab if there is one — opening a fourth copy of the app
      // to answer a check is a small thing that feels broken.
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
