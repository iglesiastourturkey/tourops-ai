/**
 * generate-vapid-keys.ts — prints a fresh VAPID key pair for Web Push.
 *
 *   pnpm --filter @workspace/api-server run vapid:generate
 *
 * Paste the output into the environment (Render dashboard for production, a
 * local .env for development). Nothing is written to disk here — the private
 * key must never land in the repo.
 *
 * Regenerating the pair invalidates every stored push_subscriptions row: the
 * browser subscriptions were created against the old public key and the push
 * service will start answering 403/410. Rows are pruned automatically on the
 * next send (lib/notifications.ts), and users simply re-enable notifications.
 */

import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
VAPID key pair generated.

Add these to the API server environment (Render → Environment):

  VAPID_PUBLIC_KEY=${publicKey}
  VAPID_PRIVATE_KEY=${privateKey}
  VAPID_SUBJECT=mailto:info@iglesiastour.com

Notes:
  - VAPID_SUBJECT must be a mailto: or https: URL identifying the key owner.
    It defaults to mailto:info@iglesiastour.com when unset.
  - Only the API server needs these. The frontend fetches the public key at
    runtime from GET /api/notifications/push/public-key — do not add a
    VITE_ copy of it, and never expose VAPID_PRIVATE_KEY to the client.
  - Keep the private key secret and out of git.
`);
