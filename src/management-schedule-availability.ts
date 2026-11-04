import { isFutureScheduleSlot } from './management-reservation-time.ts';
export type ScheduleAvailabilityCourt = { id: string; status: string };

export type ScheduleAvailabilityEvent = {
  courtId: string;
  localDate: string;
  startMinute: number;
  endMinute: number;
};

export type ScheduleVacancySelection = {
  localDate: string;
  startMinute: number;
  endMinute: number;
  availableCourtIds: string[];
  preferredCourtId?: string;
  isPast?: boolean;
};

export const SCHEDULE_DAY_START_MINUTE = 6 * 60;
export const SCHEDULE_DAY_END_MINUTE = 23 * 60;
export const SCHEDULE_SLOT_MINUTES = 60;

export function getAvailableScheduleCourtIds({
  courts,
  events,
  localDate,
  startMinute,
  durationMinutes = SCHEDULE_SLOT_MINUTES,
}: {
  courts: ScheduleAvailabilityCourt[];
  events: ScheduleAvailabilityEvent[];
  localDate: string;
  startMinute: number;
  durationMinutes?: number;
}) {
  const endMinute = startMinute + durationMinutes;
  return courts
    .filter((court) => court.status === 'active')
    .filter((court) => !events.some((event) => (
      event.courtId === court.id
      && event.localDate === localDate
      && event.startMinute < endMinute
      && event.endMinute > startMinute
    )))
    .map((court) => court.id);
}

export function buildScheduleVacancySlots({
  courts,
  events,
  localDate,
  durationMinutes = SCHEDULE_SLOT_MINUTES,
  timeZone,
  now,
}: {
  courts: ScheduleAvailabilityCourt[];
  events: ScheduleAvailabilityEvent[];
  localDate: string;
  durationMinutes?: number;
  timeZone?: string;
  now?: number;
}): ScheduleVacancySelection[] {
  const slots: ScheduleVacancySelection[] = [];
  for (
    let startMinute = SCHEDULE_DAY_START_MINUTE;
    startMinute + durationMinutes <= SCHEDULE_DAY_END_MINUTE;
    startMinute += SCHEDULE_SLOT_MINUTES
  ) {
    const availableCourtIds = getAvailableScheduleCourtIds({
      courts,
      events,
      localDate,
      startMinute,
      durationMinutes,
    });
    if (availableCourtIds.length === 0) continue;
    slots.push({
      ...(timeZone ? { isPast: !isFutureScheduleSlot({ localDate, startMinute }, timeZone, now) } : {}),
      localDate,
      startMinute,
      endMinute: startMinute + durationMinutes,
      availableCourtIds,
    });
  }
  return slots;
}
