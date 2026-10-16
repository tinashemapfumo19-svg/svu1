# Installable App and Push Notifications

## Installable app

- `manifest.webmanifest` (name, icons in `src/assets/icons/`, standalone display, shortcuts to Today, ID card and
  Calendar), linked from `index.html` with theme colour and Apple touch icon.
- `sw.js` (served from the root so it controls every page) caches **only** an offline page (`offline.html`) and its
  icon. Pages and data always come from the server; when a page load fails offline, the offline page is shown.
- `src/app-install.js` registers the worker and keeps the browser's install prompt. Settings → Notifications →
  **This device** offers **Install** when the browser allows it, or instructions (Safari: Share → Add to Home Screen).

## Push notifications

- Settings → This device → **Notifications on this device** subscribes the browser (Web Push with VAPID).
  `POST/DELETE/GET /api/me/push-subscriptions`; `GET /api/push/status` gives the public key.
- A background dispatcher (`startPushDispatcher` in `server/push-notifications.js`, every 20 s) pushes each non-secret
  Inbox message created after the device subscribed, once (claimed in `push_deliveries`, migration
  `114_push_notifications.sql`). Muted groups are never queued, so never pushed. The push shows the subject, the start
  of the body, and opens the message's link. Expired subscriptions (404/410) are removed.
- Configuration: `SVU_PUSH=enabled`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generate with
  `npx web-push generate-vapid-keys`), `VAPID_SUBJECT` (`mailto:` or `https:` contact). Dependency: `web-push@3.6.7`.

## Verification so far

Manifest, worker registration across the whole site and the offline page were checked in Chromium; the server side is
unit-tested (configuration, payload, once-only delivery, expired devices). **Subscribing and receiving a push needs a
real browser** (headless Chromium has no push service). iPhone push works only after installing to the home screen
(iOS 16.4+).
