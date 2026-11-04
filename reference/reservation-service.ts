import { assertOccupancyNotPast } from '../../../shared/management-reservation-time';
import mongoose, { type ClientSession } from 'mongoose';
import { createHash } from 'node:crypto';
import MutationReceipt from '@/models/MutationReceipt';
import CourtReservation, { type ICourtReservation } from '@/models/CourtReservation';
import GuestPassLedgerEntry from '@/models/GuestPassLedgerEntry';
import ReservationParticipant from '@/models/ReservationParticipant';
import ReservationQuote from '@/models/ReservationQuote';
import ReservationPolicySnapshot from '@/models/ReservationPolicySnapshot';
import ScheduleHold from '@/models/ScheduleHold';
import { appendGuestPassLedgerEntry } from '@/modules/associations/entitlement-service';
import { auditOperation } from '@/modules/audit/operational-audit';
import { assertStaffArenaAccess, getClubOperationAccess } from '@/modules/clubs/staff-permissions';
import { appendOperationalOutboxEvent } from '@/modules/events/operational-outbox';
import { convertScheduleHoldToReservation } from '@/modules/scheduling/schedule-store';
import type { ReservationOrigin } from '@/modules/scheduling/contracts';
import { enforceReservationLimits } from './reservation-limit-store';
import { normalizeCourtPolicyRules } from './normalizers';
import { provisionNewManualReservationInvoice } from '@/modules/billing/manual-reservation-invoice';

export type ReservationResult = {
  id: string;
  status: ICourtReservation['status'];
  origin: ReservationOrigin;
  totalCents: number;
  guaranteeDueCents: number;
  balanceDueLaterCents: number;
  overrideReason: string | null;
  replayed: boolean;
};

function resultFromReservation(
  reservation: ICourtReservation | Record<string, any>,
  replayed: boolean,
): ReservationResult {
  return {
    id: String(reservation._id),
    status: reservation.status,
    origin: reservation.origin,
    totalCents: reservation.totalCents,
    guaranteeDueCents: reservation.guaranteeDueCents,
    balanceDueLaterCents: reservation.balanceDueLaterCents,
    overrideReason: reservation.overrideReason || null,
    replayed,
  };
}

function clonePersistedSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function consumeHoldGuestPasses(input: {
  holdId: string;
  reservationId: string;
  actorUserId?: string;
  correlationId: string;
  session: ClientSession;
}) {
  const guestPassReservations = await GuestPassLedgerEntry.find({
    scheduleHoldId: input.holdId,
    reason: 'reserved',
    deltaUnits: { $lt: 0 },
  }).session(input.session).lean();
  for (const entry of guestPassReservations) {
    const units = -entry.deltaUnits;
    await appendGuestPassLedgerEntry({
      grantId: String(entry.guestPassGrantId),
      deltaUnits: units,
      reason: 'released',
      idempotencyKey: `reservation:${input.reservationId}:release:guest-pass:${entry.guestPassGrantId}`,
      scheduleHoldId: input.holdId,
      reservationId: input.reservationId,
      actorUserId: input.actorUserId,
      source: 'reservation',
      correlationId: input.correlationId,
      session: input.session,
    });
    await appendGuestPassLedgerEntry({
      grantId: String(entry.guestPassGrantId),
      deltaUnits: -units,
      reason: 'consumed',
      idempotencyKey: `reservation:${input.reservationId}:consume:guest-pass:${entry.guestPassGrantId}`,
      reservationId: input.reservationId,
      actorUserId: input.actorUserId,
      source: 'reservation',
      correlationId: input.correlationId,
      session: input.session,
    });
  }
}

async function confirmHold(input: {
  holdId: string;
  sportsClubId?: string;
  actorUserId?: string;
  externalCustomerId?: string;
  reservationPaymentId?: string;
  idempotencyKey: string;
  now: Date;
  origin: ReservationOrigin;
  staffOverride: boolean;
  staffFinancialTreatment?: 'deferred' | 'quoted';
  paymentSatisfied?: boolean;
  overrideReason?: string;
}, options: { session?: ClientSession } = {}): Promise<ReservationResult> {
  if (
    !mongoose.isValidObjectId(input.holdId)
    || (input.sportsClubId !== undefined && !mongoose.isValidObjectId(input.sportsClubId))
    || (input.actorUserId !== undefined && !mongoose.isValidObjectId(input.actorUserId))
    || (input.externalCustomerId !== undefined && !mongoose.isValidObjectId(input.externalCustomerId))
    || (Boolean(input.actorUserId) === Boolean(input.externalCustomerId) && !input.staffOverride)
    || (input.staffOverride && !input.actorUserId)
    || !input.idempotencyKey?.trim()
    || input.idempotencyKey.trim().length > 240
    || !Number.isFinite(input.now.getTime())
  ) throw new Error('RESERVATION_CONFIRM_INPUT_INVALID');
  const overrideReason = input.overrideReason?.trim();
  if (overrideReason && overrideReason.length > 500) {
    throw new Error('RESERVATION_OVERRIDE_REASON_INVALID');
  }
  const ownsSession = !options.session;
  const session = options.session || await mongoose.startSession();
  let result: ReservationResult | undefined;
  try {
    const execute = async () => {
      const existing = await CourtReservation.findOne({ holdId: input.holdId }).session(session);
      if (existing) {
        if (input.sportsClubId !== undefined && String(existing.sportsClubId) !== input.sportsClubId) {
          throw new Error('HOLD_NOT_FOUND');
        }
        if (input.staffOverride) {
          if (!input.actorUserId) throw new Error('STAFF_USER_REQUIRED');
          const access = await getClubOperationAccess({
            sportsClubId: String(existing.sportsClubId),
            userId: input.actorUserId,
            permission: 'manage_reservations',
          }, { session });
          if (!access.allowed) throw new Error(access.code);
          assertStaffArenaAccess(access, String(existing.arenaId));
        } else {
          if (input.actorUserId && String(existing.responsibleUserId || '') !== input.actorUserId) {
            throw new Error('HOLD_NOT_FOUND');
          }
          if (
            input.externalCustomerId
            && String(existing.externalCustomerId || '') !== input.externalCustomerId
          ) {
            throw new Error('HOLD_NOT_FOUND');
          }
        }
        result = resultFromReservation(existing, true);
        return;
      }
      const hold = await ScheduleHold.findById(input.holdId)
        .select('+participants')
        .session(session);
      if (!hold) throw new Error('HOLD_NOT_FOUND');
      if (input.sportsClubId !== undefined && String(hold.sportsClubId) !== input.sportsClubId) {
        throw new Error('HOLD_NOT_FOUND');
      }
      if (hold.status !== 'active') throw new Error('HOLD_NOT_ACTIVE');
      assertOccupancyNotPast(hold.endsAt, input.now.getTime());
      if (hold.expiresAt <= input.now) throw new Error('HOLD_EXPIRED');
      if (!input.staffOverride) {
        if (input.actorUserId && String(hold.actorUserId) !== input.actorUserId) {
          throw new Error('HOLD_NOT_FOUND');
        }
        if (input.externalCustomerId && String(hold.externalCustomerId) !== input.externalCustomerId) {
          throw new Error('HOLD_NOT_FOUND');
        }
      }
      if (input.staffOverride) {
        if (!input.actorUserId) throw new Error('STAFF_USER_REQUIRED');
        const access = await getClubOperationAccess({
          sportsClubId: String(hold.sportsClubId),
          userId: input.actorUserId,
          permission: 'manage_reservations',
        }, { session });
        if (!access.allowed) throw new Error(access.code);
        assertStaffArenaAccess(access, String(hold.arenaId));
      }
      const quote = await ReservationQuote.findById(hold.quoteId).session(session).lean();
      if (!quote) throw new Error('HOLD_QUOTE_NOT_FOUND');
      if (
        !input.staffOverride
        && !input.paymentSatisfied
        && (quote.guaranteeDueCents > 0 || quote.guestFeesCents > 0 || quote.dueNowCents > 0)
      ) throw new Error('PAYMENT_REQUIRED');

      const policySnapshot = await ReservationPolicySnapshot.findById(hold.policySnapshotId).session(session).lean();
      if (!policySnapshot) throw new Error('HOLD_POLICY_NOT_FOUND');
      await enforceReservationLimits({
        sportsClubId: String(hold.sportsClubId),
        ...(hold.responsibleUserId ? { responsibleUserId: String(hold.responsibleUserId) } : { externalCustomerId: String(hold.externalCustomerId) }),
        startsAt: hold.startsAt, endsAt: hold.endsAt, now: input.now, timeZone: hold.timeZone,
        limits: normalizeCourtPolicyRules(policySnapshot.rules).reservationLimits,
        excludeHoldId: String(hold._id), session,
      });

      const reservationId = new mongoose.Types.ObjectId();
      const status = quote.requiresApproval ? 'pending_approval' : 'confirmed';
      const useQuotedStaffFinancials = input.staffOverride
        && input.staffFinancialTreatment === 'quoted';
      const actualGuaranteeCents = input.staffOverride
        ? useQuotedStaffFinancials ? quote.dueNowCents : 0
        : input.paymentSatisfied ? quote.dueNowCents : quote.guaranteeDueCents;
      const balanceDueLaterCents = input.staffOverride
        ? useQuotedStaffFinancials ? quote.balanceAtVenueCents : quote.totalCents
        : input.paymentSatisfied ? quote.balanceAtVenueCents : quote.balanceDueLaterCents;
      const [reservation] = await CourtReservation.create([{
        _id: reservationId,
        sportsClubId: hold.sportsClubId,
        arenaId: hold.arenaId,
        courtId: hold.courtId,
        holdId: hold._id,
        quoteId: hold.quoteId,
        policySnapshotId: hold.policySnapshotId,
        status,
        origin: input.origin,
        ...(input.actorUserId ? { createdByUserId: input.actorUserId } : {}),
        ...(hold.responsibleUserId ? { responsibleUserId: hold.responsibleUserId } : {}),
        ...(hold.externalCustomerId ? { externalCustomerId: hold.externalCustomerId } : {}),
        ...(input.reservationPaymentId ? { reservationPaymentId: input.reservationPaymentId } : {}),
        ...(input.staffOverride ? { assistedByUserId: input.actorUserId } : {}),
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        timeZone: hold.timeZone,
        totalCents: quote.totalCents,
        guaranteeDueCents: actualGuaranteeCents,
        balanceDueLaterCents,
        currency: 'BRL',
        requiresApproval: quote.requiresApproval,
        ...(overrideReason ? { overrideReason } : {}),
        idempotencyKey: input.idempotencyKey.trim(),
        correlationId: hold.correlationId,
        associationSnapshot: clonePersistedSnapshot(hold.associationSnapshot),
      }], { session });
      let consumedGuestPasses = 0;
      const paidGuestCount = Math.max(0, quote.participantComposition.guests - quote.guestPasses);
      const guestFeeCents = paidGuestCount > 0
        ? Math.floor(quote.guestFeesCents / paidGuestCount)
        : 0;
      const participantDocuments = hold.participants.map((participant) => {
        const guestPassConsumed = participant.kind === 'guest'
          && consumedGuestPasses < quote.guestPasses;
        if (guestPassConsumed) consumedGuestPasses += 1;
        return ({
        sportsClubId: hold.sportsClubId,
        reservationId,
        kind: participant.kind,
        ...(participant.userId ? { userId: participant.userId } : {}),
        ...(participant.representedDependentId
          ? { representedDependentId: participant.representedDependentId }
          : {}),
        ...(participant.externalCustomerId
          ? { externalCustomerId: participant.externalCustomerId }
          : {}),
        ...(participant.guestName ? { guestName: participant.guestName } : {}),
        status: 'confirmed',
        feeResponsibility: participant.feeResponsibility,
        guestFeeCents: participant.kind === 'guest' && !guestPassConsumed ? guestFeeCents : 0,
        guestPassConsumed,
        sortOrder: participant.sortOrder,
        role: participant.role,
      });
      });
      if (participantDocuments.length > 0) {
        await ReservationParticipant.insertMany(participantDocuments, { session });
      }
      if (!input.staffOverride && input.reservationPaymentId) {
        await provisionNewManualReservationInvoice({
          sportsClubId: String(reservation.sportsClubId), reservationId: String(reservationId),
          actorUserId: input.actorUserId, session, now: input.now,
        });
      }
      await convertScheduleHoldToReservation({
        courtId: String(hold.courtId),
        holdId: String(hold._id),
        reservationId: String(reservationId),
        session,
      });
      await consumeHoldGuestPasses({
        holdId: String(hold._id),
        reservationId: String(reservationId),
        actorUserId: input.actorUserId,
        correlationId: hold.correlationId,
        session,
      });
      hold.status = 'converted';
      hold.convertedReservationId = reservationId;
      await hold.save({ session });
      await auditOperation({
        sportsClubId: String(hold.sportsClubId),
        arenaId: String(hold.arenaId),
        actorUserId: input.actorUserId,
        channel: input.staffOverride ? 'web' : 'app',
        command: 'court_reservation.create',
        targetType: 'court_reservation',
        targetId: String(reservationId),
        result: 'succeeded',
        reason: overrideReason,
        correlationId: hold.correlationId,
        idempotencyKey: input.idempotencyKey.trim(),
        after: {
          status,
          origin: input.origin,
          startsAt: hold.startsAt.toISOString(),
          endsAt: hold.endsAt.toISOString(),
        },
      }, { session });
      await appendOperationalOutboxEvent({
        sportsClubId: String(hold.sportsClubId),
        aggregateType: 'court_reservation',
        aggregateId: String(reservationId),
        eventType: 'reservation.created',
        deduplicationKey: `reservation.created:${reservationId}`,
        payload: {
          reservationId: String(reservationId),
          sportsClubId: String(hold.sportsClubId),
          ...(hold.responsibleUserId
            ? { responsibleUserId: String(hold.responsibleUserId) }
            : {}),
          ...(hold.externalCustomerId
            ? { externalCustomerId: String(hold.externalCustomerId) }
            : {}),
          status,
          origin: input.origin,
          startsAt: hold.startsAt.toISOString(),
        },
        session,
      });
      result = resultFromReservation(reservation, false);
    };
    if (ownsSession) await session.withTransaction(execute);
    else await execute();
    if (!result) throw new Error('RESERVATION_CONFIRM_TRANSACTION_DID_NOT_COMMIT');
    return result;
  } finally {
    if (ownsSession) await session.endSession();
  }
}

export function confirmReservationHold(input: {
  holdId: string;
  actorUserId: string;
  idempotencyKey: string;
  now?: Date;
}): Promise<ReservationResult> {
  return confirmHold({
    ...input,
    now: input.now || new Date(),
    origin: 'member_app',
    staffOverride: false,
  });
}

type StaffHoldReceiptInput = {
  sportsClubId: string; holdId: string; actorUserId: string; idempotencyKey: string;
};
export type StaffHoldConfirmationReceipt = ReservationResult & { holdId: string };
const HOLD_CONFIRM_SCOPE = 'reservation-hold.confirm';

async function authorizeStaffHold(input: StaffHoldReceiptInput, session?: ClientSession) {
  if (![input.sportsClubId, input.holdId, input.actorUserId].every(id => mongoose.isValidObjectId(id))
    || !input.idempotencyKey?.trim() || input.idempotencyKey.trim().length > 240) {
    throw new Error('RESERVATION_CONFIRM_INPUT_INVALID');
  }
  const access = await getClubOperationAccess({ sportsClubId: input.sportsClubId,
    userId: input.actorUserId, permission: 'manage_reservations' }, { session });
  if (!access.allowed) throw new Error(access.code);
  const hold = await ScheduleHold.findOne({ _id: input.holdId, sportsClubId: input.sportsClubId }).session(session || null).lean();
  if (!hold) throw new Error('HOLD_NOT_FOUND');
  assertStaffArenaAccess(access, String(hold.arenaId));
  return hold;
}

export async function confirmStaffHoldWithReceipt(input: StaffHoldReceiptInput & {
  origin: Extract<ReservationOrigin, 'reception' | 'phone' | 'whatsapp'>;
  overrideReason?: string; now?: Date;
}): Promise<StaffHoldConfirmationReceipt> {
  if (!['reception', 'phone', 'whatsapp'].includes(input.origin)) throw new Error('RESERVATION_ORIGIN_INVALID');
  const reason = input.overrideReason?.trim() || '';
  if (reason.length > 500) throw new Error('RESERVATION_OVERRIDE_REASON_INVALID');
  const fingerprint = createHash('sha256').update(JSON.stringify([input.sportsClubId, input.holdId, input.origin, reason])).digest('hex');
  const session = await mongoose.startSession();
  let receipt: StaffHoldConfirmationReceipt | undefined;
  try {
    await session.withTransaction(async () => {
      const hold = await authorizeStaffHold(input, session);
      const existing = await MutationReceipt.findOne({ scope: HOLD_CONFIRM_SCOPE,
        actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey.trim() }).session(session).lean();
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) throw new Error('IDEMPOTENCY_KEY_REUSED');
        receipt = { ...(existing.result.receipt as StaffHoldConfirmationReceipt), replayed: true };
        return;
      }
      // A converted hold is not evidence that this new command was applied.
      if (hold.status !== 'active') throw new Error('HOLD_NOT_ACTIVE');
      const result = await confirmHold({ ...input, overrideReason: reason, now: input.now || new Date(), staffOverride: true }, { session });
      receipt = { ...result, holdId: input.holdId };
      await MutationReceipt.create([{ scope: HOLD_CONFIRM_SCOPE, actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey.trim(), requestFingerprint: fingerprint,
        result: { sportsClubId: input.sportsClubId, holdId: input.holdId, receipt } }], { session });
    });
    if (!receipt) throw new Error('RESERVATION_CONFIRM_TRANSACTION_DID_NOT_COMMIT');
    return receipt;
  } finally { await session.endSession(); }
}

export async function readStaffHoldConfirmationResult(input: StaffHoldReceiptInput): Promise<
  { status: 'unknown' } | { status: 'confirmed'; receipt: StaffHoldConfirmationReceipt }
> {
  await authorizeStaffHold(input);
  const record = await MutationReceipt.findOne({ scope: HOLD_CONFIRM_SCOPE, actorUserId: input.actorUserId,
    idempotencyKey: input.idempotencyKey.trim(), 'result.sportsClubId': input.sportsClubId, 'result.holdId': input.holdId }).lean();
  if (!record) return { status: 'unknown' };
  const receipt = record.result.receipt as StaffHoldConfirmationReceipt;
  if (!receipt || receipt.holdId !== input.holdId || !mongoose.isValidObjectId(receipt.id)) throw new Error('HOLD_CONFIRM_RECEIPT_INVALID');
  return { status: 'confirmed', receipt: { ...receipt, replayed: true } };
}

export function createStaffAssistedReservation(input: {
  holdId: string;
  sportsClubId?: string;
  actorUserId: string;
  idempotencyKey: string;
  origin: Extract<ReservationOrigin, 'reception' | 'phone' | 'whatsapp'>;
  overrideReason?: string;
  now?: Date;
}): Promise<ReservationResult> {
  return confirmHold({
    ...input,
    now: input.now || new Date(),
    staffOverride: true,
  });
}

export function createQuotedStaffAssistedReservationInSession(input: {
  holdId: string;
  actorUserId: string;
  reservationPaymentId?: string;
  idempotencyKey: string;
  origin: Extract<ReservationOrigin, 'reception' | 'phone' | 'whatsapp'>;
  overrideReason?: string;
  now: Date;
  session: ClientSession;
}): Promise<ReservationResult> {
  const { session, ...command } = input;
  return confirmHold({
    ...command,
    staffOverride: true,
    staffFinancialTreatment: 'quoted',
  }, { session });
}

export function confirmPaidReservationFromHold(input: {
  holdId: string;
  actorUserId?: string;
  externalCustomerId?: string;
  reservationPaymentId: string;
  idempotencyKey: string;
  now?: Date;
}): Promise<ReservationResult> {
  return confirmHold({
    ...input,
    now: input.now || new Date(),
    origin: 'public_web',
    staffOverride: false,
    paymentSatisfied: true,
  });
}

const APPROVAL_SCOPE = 'court-reservation.approve';

type ReservationApprovalReceiptRecord = {
  requestFingerprint: string;
  result: { sportsClubId: string; reservation: ReservationResult };
};

export async function readReservationApprovalReceipt(input: {
  sportsClubId: string; reservationId: string; actorUserId: string; idempotencyKey: string;
}): Promise<{ status: 'unknown' } | { status: 'confirmed'; receipt: ReservationResult }> {
  if (![input.sportsClubId, input.reservationId, input.actorUserId].every(id => mongoose.isValidObjectId(id))
    || !input.idempotencyKey?.trim() || input.idempotencyKey.length > 240) throw new Error('RESERVATION_APPROVAL_INPUT_INVALID');
  const access = await getClubOperationAccess({ sportsClubId: input.sportsClubId, userId: input.actorUserId, permission: 'manage_reservations' });
  if (!access.allowed) throw new Error(access.code);
  const reservation = await CourtReservation.findOne({ _id: input.reservationId, sportsClubId: input.sportsClubId }).select('arenaId').lean();
  if (!reservation) throw new Error('RESERVATION_NOT_FOUND');
  assertStaffArenaAccess(access, String(reservation.arenaId));
  const stored = await MutationReceipt.findOne({ scope: APPROVAL_SCOPE, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey.trim() }).lean<ReservationApprovalReceiptRecord | null>();
  // Current status alone cannot prove that this particular command completed.
  if (!stored || stored.result.sportsClubId !== input.sportsClubId || stored.result.reservation.id !== input.reservationId) return { status: 'unknown' };
  return { status: 'confirmed', receipt: { ...stored.result.reservation, replayed: true } };
}

export async function approveReservation(input: {
  sportsClubId: string;
  reservationId: string;
  actorUserId: string;
  reason: string;
  idempotencyKey?: string;
  now?: Date;
}): Promise<ReservationResult> {
  if (!mongoose.isValidObjectId(input.sportsClubId)
    || !mongoose.isValidObjectId(input.reservationId)
    || !mongoose.isValidObjectId(input.actorUserId)
    || !input.reason?.trim()
    || (input.idempotencyKey !== undefined && (!input.idempotencyKey.trim() || input.idempotencyKey.length > 240))) throw new Error('RESERVATION_APPROVAL_INPUT_INVALID');
  const key = input.idempotencyKey?.trim();
  const requestFingerprint = createHash('sha256').update(JSON.stringify([input.sportsClubId, input.reservationId, input.reason.trim()])).digest('hex');
  const session = await mongoose.startSession();
  let result: ReservationResult | undefined;
  try {
    await session.withTransaction(async () => {
      const access = await getClubOperationAccess({
        sportsClubId: input.sportsClubId,
        userId: input.actorUserId,
        permission: 'manage_reservations',
      }, { session });
      if (!access.allowed) throw new Error(access.code);
      const reservation = await CourtReservation.findOne({
        _id: input.reservationId,
        sportsClubId: input.sportsClubId,
      }).session(session);
      if (!reservation) throw new Error('RESERVATION_NOT_FOUND');
      assertStaffArenaAccess(access, String(reservation.arenaId));
      if (key) {
        const stored = await MutationReceipt.findOne({ scope: APPROVAL_SCOPE, actorUserId: input.actorUserId, idempotencyKey: key }).session(session).lean<ReservationApprovalReceiptRecord | null>();
        if (stored) {
          if (stored.requestFingerprint !== requestFingerprint) throw new Error('IDEMPOTENCY_KEY_REUSED');
          result = { ...stored.result.reservation, replayed: true };
          return;
        }
      }
      const persistReceipt = async () => {
        if (key) await MutationReceipt.create([{ scope: APPROVAL_SCOPE, actorUserId: input.actorUserId,
          idempotencyKey: key, requestFingerprint, result: { sportsClubId: input.sportsClubId, reservation: result } }], { session });
      };
      if (reservation.status === 'confirmed') {
        result = resultFromReservation(reservation, true);
        await persistReceipt();
        return;
      }
      assertOccupancyNotPast(reservation.endsAt, input.now?.getTime() ?? Date.now());
      if (reservation.status !== 'pending_approval') {
        throw new Error('RESERVATION_APPROVAL_STATUS_INVALID');
      }
      reservation.status = 'confirmed';
      await reservation.save({ session });
      await auditOperation({
        sportsClubId: input.sportsClubId,
        arenaId: String(reservation.arenaId),
        actorUserId: input.actorUserId,
        channel: 'web',
        command: 'court_reservation.approve',
        targetType: 'court_reservation',
        targetId: String(reservation._id),
        result: 'succeeded',
        reason: input.reason.trim(),
        correlationId: reservation.correlationId,
        before: { status: 'pending_approval' },
        after: { status: 'confirmed' },
      }, { session });
      result = resultFromReservation(reservation, false);
      await persistReceipt();
    });
    if (!result) throw new Error('RESERVATION_APPROVAL_TRANSACTION_DID_NOT_COMMIT');
    return result;
  } finally {
    await session.endSession();
  }
}
