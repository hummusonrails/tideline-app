import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

export interface SyncError {
  message: string;
  status: number | null;
  at: string;
}

/** The last sync failure, or undefined when the backend is reachable. */
export function useSyncError(): SyncError | undefined {
  const row = useLiveQuery(() => db.meta.get('sync-error'));
  return row?.value as SyncError | undefined;
}

/** Force the sync loop to attempt again now. */
export function retrySync(): void {
  window.dispatchEvent(new CustomEvent('tideline:outbox-enqueued'));
  // The pull side keys off the same focus/online ticks; nudge visibility.
  window.dispatchEvent(new Event('online'));
}
