# Manual verification checklist

The automated suites (`npm run check`, `npm run check:functions`, `npm run test:browser`) cover most behavior. Use this checklist for what they can't: real browsers, real devices, and a real Cloudflare deployment.

## Local runtime

Run in a normal development environment with loopback networking:

- [ ] `npm ci`, `npm run check`, and `npm run check:functions` pass.
- [ ] `npm run migrate:local` applies the checked-in migrations. Run it again and confirm no migrations remain.
- [ ] `npm run room:list -- --local` reports `game-night` as unprovisioned.
- [ ] `npm run room:provision -- game-night --local` prints a usable private fragment URL.
- [ ] Provisioning the same room again refuses to replace its secret.
- [ ] `npm run dev` serves the static frontend and API at the printed origin.
- [ ] Restart Wrangler and reopen the link; names, responses and stars persist.
- [ ] Rotation with `--local` revokes the old link and keeps room state.
- [ ] Local commands never contact or modify production D1.

## Two-browser behavior

Use two separate browsers/profiles with the same local link. Never include the link in committed screenshots.

- [ ] Browser A sees the friendly empty-room prompt and adds Alice. Browser B loads Alice.
- [ ] Browser B adds Bob. A sees Bob only after manual Refresh.
- [ ] Mark Alice Yes on one day in A and Bob on another in B. Refresh both and verify neither edit was lost.
- [ ] Set different days for Alice concurrently. Both dates persist.
- [ ] Rapidly change the same cell, including while saving. Its final state survives reload.
- [ ] Star at least two dates. Both remain starred after reload. Unstarring does not alter responses.
- [ ] Check totals for zero, some, and everyone available. With zero participants no day says everyone available.
- [ ] Add nine total names, then race two different joins. Exactly ten names remain. Race the same case-insensitive name and get only one record.
- [ ] Duplicate names with different capitalization or composed/decomposed accents receive a friendly error.
- [ ] At ten names the add control is disabled with a full-room explanation.
- [ ] Cancel a removal and verify nothing changes. Confirm removal and verify its responses disappear. Re-add the name and verify an empty row with a new ID.
- [ ] Select a participant, reload, and see the highlight if they still exist. A removed remembered participant never selects another person's row.
- [ ] Local edits do not change Last refreshed. Successful full Refresh does; a failed refresh does not.
- [ ] Slow the network, change a cell, then press Refresh. Refresh waits for the save, and controls prevent edits while applying the snapshot.
- [ ] Disconnect during a save. See a clear failure, restored confirmed display, and Try again. Make an unrelated successful edit and verify the failed edit remains visibly marked and retryable. Fail several cells, then reconnect and use Retry changes; reload to confirm every desired value persisted.
- [ ] Disconnect during Refresh. Existing names/responses and the old timestamp remain, with an error.
- [ ] Leave the page idle and inspect Network. No polling, subscriptions, third-party scripts, or automatic refresh occurs.
- [ ] Missing room/key and invalid/revoked links show friendly messages without raw JSON or private data.

## Visual and accessibility

- [ ] Inspect at 320, 375, 768, and 1280 CSS pixels wide. The calendar may scroll; the page itself should not scroll horizontally. Sticky headers remain readable while scrolling.
- [ ] Check long Unicode names, narrow-screen join controls, full room, empty room, and error messages.
- [ ] Every response, star, removal control, Refresh, and add control works using a keyboard. Focus is visible. Enter submits a name.
- [ ] Screen-reader labels identify participant/date, and stars expose their pressed state. Save/error status is announced. Table row/column headings remain meaningful.
- [ ] Stars use a filled shape and responses use distinct symbols (✓, X, ~); everyone-available totals include text. State is understandable without color.
- [ ] Text contrast, 200% zoom, touch targets, and reduced-motion preference are usable on actual devices/browsers.

## Deployment

- [ ] `main` is linked through the current Pages Git integration.
- [ ] Production D1 UUID replaces the placeholder; checked-in migrations apply remotely before deploying code that needs them.
- [ ] A push to `main` deploys static frontend and Functions, and `context.env.DB` works.
- [ ] HTTPS, CSP, no-referrer, API no-store, and no CORS access are confirmed on real responses. Cloudflare logs do not capture Authorization values.
- [ ] Static file requests bypass Functions. `/config/rooms.json`, `/migrations/…`, and other source paths reveal no source/data (Pages may serve its static fallback).
- [ ] Preview has no DB binding, returns the clear 503 API-unavailable message, and cannot mutate production state.
- [ ] Provision a deployed approved room; open its generated link in two browsers and repeat the core behavior checks.
- [ ] Remove a whitelist entry and deploy: access becomes 404 while D1 state remains. Re-add/deploy: existing link/data work again.
- [ ] Inspect Git content and static output for real secrets/credentials/database files before pushing. Check Cloudflare's current free-tier usage/quotas.
