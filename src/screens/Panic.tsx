import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useSession } from '../state/session';

/**
 * "I lost my phone" page. Wipes local state on confirmation.
 * Does NOT revoke the PAT remotely — that has to be done in the GitHub UI.
 */
export function Panic() {
  const session = useSession();
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="min-h-dvh grid place-items-center p-6">
      <div className="glass rounded-3xl p-6 max-w-sm text-center">
        <ShieldAlert className="mx-auto mb-3 text-coral" size={36} />
        <div className="font-display text-2xl font-semibold mb-2">Wipe this device?</div>
        <p className="text-ink-600 text-sm">
          This deletes the local copy of your data (messages, photos, points) and
          signs you out. The data in your private backend is not affected, and
          you can re-sync on another device.
        </p>
        <p className="text-ink-600 text-sm mt-3">
          <strong>Important:</strong> if your device is actually lost, also revoke your
          access token from your GitHub account settings.
        </p>
        {!confirmed ? (
          <button
            type="button"
            onClick={() => setConfirmed(true)}
            className="mt-5 w-full rounded-full bg-coral text-white font-medium py-3"
          >
            I'm sure, wipe it
          </button>
        ) : (
          <button
            type="button"
            onClick={() => session.panic()}
            className="mt-5 w-full rounded-full bg-coral text-white font-medium py-3"
          >
            Tap again to confirm
          </button>
        )}
        <a href={import.meta.env.BASE_URL} className="block mt-3 text-sm text-ink-600">Cancel</a>
      </div>
    </div>
  );
}
