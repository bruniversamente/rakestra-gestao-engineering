import { localDateTimeInTimeZoneToIso } from './management-local-time.ts';
export function isFutureReservationStart(localDateTime: string, timeZone: string, now = Date.now()): boolean {
  try { return Date.parse(localDateTimeInTimeZoneToIso(localDateTime, timeZone)) > now; } catch { return false; }
}
export function isFutureScheduleSlot(slot: { localDate: string; startMinute: number }, timeZone: string, now = Date.now()): boolean {
  const hour = String(Math.floor(slot.startMinute / 60)).padStart(2, '0');
  const minute = String(slot.startMinute % 60).padStart(2, '0');
  return isFutureReservationStart(`${slot.localDate}T${hour}:${minute}`, timeZone, now);
}

export function isPastOccupancy(endsAt: string | Date, now = Date.now()): boolean {
  const end = new Date(endsAt).getTime();
  return !Number.isFinite(end) || end <= now;
}
export function assertOccupancyNotPast(endsAt: string | Date, now = Date.now()): void {
  if (isPastOccupancy(endsAt, now)) throw new Error('SCHEDULE_HISTORY_READ_ONLY');
}
