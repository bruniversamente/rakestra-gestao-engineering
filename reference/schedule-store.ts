import mongoose, { type ClientSession, type Types } from "mongoose";
import CourtDaySchedule, {
  type ScheduleOccupancySegment,
} from "@/models/CourtDaySchedule";
import type {
  NormalizedScheduleInterval,
  ScheduleOccupancyKind,
} from "./contracts";

type ComparableOccupancy = Pick<
  ScheduleOccupancySegment,
  "kind" | "status" | "startMinute" | "endMinute"
> & { expiresAt?: Date };

type CandidateInterval = {
  startMinute: number;
  endMinute: number;
  now: Date;
};

export function occupancyBlocksInterval(
  occupancy: ComparableOccupancy,
  candidate: CandidateInterval,
): boolean {
  if (occupancy.status !== "active") return false;
  if (
    occupancy.kind === "hold" &&
    (!occupancy.expiresAt ||
      occupancy.expiresAt.getTime() <= candidate.now.getTime())
  )
    return false;
  return (
    occupancy.startMinute < candidate.endMinute &&
    occupancy.endMinute > candidate.startMinute
  );
}

function objectId(
  value: string,
  errorCode = "SCHEDULE_REFERENCE_INVALID",
): Types.ObjectId {
  if (!mongoose.isObjectIdOrHexString(value)) throw new Error(errorCode);
  return new mongoose.Types.ObjectId(value);
}

function activeConflictFilter(
  startMinute: number,
  endMinute: number,
  now: Date,
) {
  return {
    $elemMatch: {
      status: "active",
      startMinute: { $lt: endMinute },
      endMinute: { $gt: startMinute },
      $or: [
        { kind: { $ne: "hold" } },
        { kind: "hold", expiresAt: { $gt: now } },
      ],
    },
  };
}

export function normalizeScheduleConflict(error: unknown): Error {
  const candidate = error as {
    code?: number;
    message?: string;
    errorLabels?: string[];
  };
  const message = candidate?.message || String(error);
  if (
    candidate?.code === 11000 ||
    /E11000|WriteConflict|SCHEDULE_INTERVAL_CONFLICT/.test(message) ||
    candidate?.errorLabels?.includes("TransientTransactionError")
  )
    return new Error("SCHEDULE_INTERVAL_CONFLICT");
  return error instanceof Error ? error : new Error("SCHEDULE_WRITE_FAILED");
}

export async function reserveScheduleInterval(input: {
  courtId: string;
  arenaId: string;
  sportsClubId: string;
  interval: NormalizedScheduleInterval;
  kind: ScheduleOccupancyKind;
  referenceId: string;
  expiresAt?: Date;
  now: Date;
  session: ClientSession;
}): Promise<void> {
  const courtId = objectId(input.courtId, "SCHEDULE_COURT_INVALID");
  const arenaId = objectId(input.arenaId, "SCHEDULE_ARENA_INVALID");
  const sportsClubId = objectId(input.sportsClubId, "SCHEDULE_CLUB_INVALID");
  const referenceId = objectId(input.referenceId);
  const segments = [...input.interval.segments].sort((left, right) =>
    left.localDate.localeCompare(right.localDate),
  );
  if (
    input.kind === "hold" &&
    (!input.expiresAt || input.expiresAt <= input.now)
  ) {
    throw new Error("SCHEDULE_HOLD_EXPIRY_INVALID");
  }

  try {
    for (const segment of segments) {
      await CourtDaySchedule.findOneAndUpdate(
        {
          courtId,
          localDate: segment.localDate,
          occupancies: {
            $not: activeConflictFilter(
              segment.startMinute,
              segment.endMinute,
              input.now,
            ),
          },
        },
        {
          $setOnInsert: {
            sportsClubId,
            arenaId,
            courtId,
            localDate: segment.localDate,
            timeZone: input.interval.timeZone,
          },
          $inc: { version: 1 },
          $push: {
            occupancies: {
              kind: input.kind,
              referenceId,
              startsAt: segment.startsAt,
              endsAt: segment.endsAt,
              startMinute: segment.startMinute,
              endMinute: segment.endMinute,
              status: "active",
              ...(input.kind === "hold" ? { expiresAt: input.expiresAt } : {}),
            },
          },
        },
        {
          upsert: true,
          new: true,
          session: input.session,
          runValidators: true,
        },
      );
    }
  } catch (error) {
    throw normalizeScheduleConflict(error);
  }
}

export async function releaseScheduleInterval(input: {
  courtId: string;
  referenceId: string;
  kind: ScheduleOccupancyKind;
  session: ClientSession;
}): Promise<number> {
  const result = await CourtDaySchedule.updateMany(
    {
      courtId: objectId(input.courtId, "SCHEDULE_COURT_INVALID"),
      occupancies: {
        $elemMatch: {
          referenceId: objectId(input.referenceId),
          kind: input.kind,
          status: "active",
        },
      },
    },
    {
      $set: { "occupancies.$[occupancy].status": "released" },
      $inc: { version: 1 },
    },
    {
      session: input.session,
      arrayFilters: [
        {
          "occupancy.referenceId": objectId(input.referenceId),
          "occupancy.kind": input.kind,
          "occupancy.status": "active",
        },
      ],
    },
  );
  return result.modifiedCount;
}

export async function updateScheduleHoldExpiry(input: {
  courtId: string;
  holdId: string;
  expiresAt: Date;
  session: ClientSession;
}): Promise<number> {
  const result = await CourtDaySchedule.updateMany(
    {
      courtId: objectId(input.courtId, "SCHEDULE_COURT_INVALID"),
      occupancies: {
        $elemMatch: {
          referenceId: objectId(input.holdId),
          kind: "hold",
          status: "active",
        },
      },
    },
    {
      $set: { "occupancies.$[occupancy].expiresAt": input.expiresAt },
      $inc: { version: 1 },
    },
    {
      session: input.session,
      arrayFilters: [{
        "occupancy.referenceId": objectId(input.holdId),
        "occupancy.kind": "hold",
        "occupancy.status": "active",
      }],
    },
  );
  if (result.modifiedCount === 0) throw new Error("HOLD_OCCUPANCY_LOST");
  return result.modifiedCount;
}

export async function convertScheduleHoldToReservation(input: {
  courtId: string;
  holdId: string;
  reservationId: string;
  session: ClientSession;
}): Promise<number> {
  const holdId = objectId(input.holdId);
  const result = await CourtDaySchedule.updateMany(
    {
      courtId: objectId(input.courtId, 'SCHEDULE_COURT_INVALID'),
      occupancies: {
        $elemMatch: {
          referenceId: holdId,
          kind: 'hold',
          status: 'active',
        },
      },
    },
    {
      $set: {
        'occupancies.$[occupancy].kind': 'reservation',
        'occupancies.$[occupancy].referenceId': objectId(input.reservationId),
      },
      $unset: { 'occupancies.$[occupancy].expiresAt': '' },
      $inc: { version: 1 },
    },
    {
      session: input.session,
      arrayFilters: [{
        'occupancy.referenceId': holdId,
        'occupancy.kind': 'hold',
        'occupancy.status': 'active',
      }],
    },
  );
  if (result.modifiedCount === 0) throw new Error('HOLD_OCCUPANCY_LOST');
  return result.modifiedCount;
}

export async function isScheduleIntervalFree(input: {
  courtId: string;
  interval: NormalizedScheduleInterval;
  now: Date;
  session?: ClientSession;
}): Promise<boolean> {
  const courtId = objectId(input.courtId, "SCHEDULE_COURT_INVALID");
  for (const segment of input.interval.segments) {
    const conflict = await CourtDaySchedule.exists({
      courtId,
      localDate: segment.localDate,
      occupancies: activeConflictFilter(
        segment.startMinute,
        segment.endMinute,
        input.now,
      ),
    }).session(input.session || null);
    if (conflict) return false;
  }
  return true;
}
