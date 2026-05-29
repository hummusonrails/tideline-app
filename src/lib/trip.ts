import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { todayYMD } from './time';

export interface TripMeta {
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

/** Trip metadata pulled from the itinerary doc, or undefined pre-sync. */
export function useTripMeta(): TripMeta | undefined {
  const row = useLiveQuery(() => db.meta.get('trip-meta'));
  return row?.value as TripMeta | undefined;
}

/** True when today is before the trip's first day (competition not started). */
export function isBeforeTrip(startDate: string | undefined, today: string = todayYMD()): boolean {
  return !!startDate && today < startDate;
}

/** Non-hook read of the trip start date, for use outside React (award logic). */
export async function tripStartDate(): Promise<string | null> {
  const row = await db.meta.get('trip-meta');
  const meta = row?.value as TripMeta | undefined;
  return meta?.startDate ?? null;
}
