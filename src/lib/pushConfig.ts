/**
 * VAPID public key for Web Push.
 *
 * This is the PUBLIC half of the keypair — it is meant to ship to clients and
 * reveals nothing. The private half lives only as a GitHub Actions secret in
 * the data repo, where the notifier workflow signs pushes with it.
 *
 * Generate the pair once (see README, "Push notifications") and paste the
 * public key here. Until it's set, the app reports notifications as
 * unavailable rather than failing at subscribe time.
 *
 * A `VITE_VAPID_PUBLIC_KEY` env var overrides this at build time if you'd
 * rather not keep it in source.
 */
const BAKED_IN = '';

export const VAPID_PUBLIC_KEY: string =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || BAKED_IN;

export function isPushConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0;
}
