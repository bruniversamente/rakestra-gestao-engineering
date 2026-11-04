import type { ClientSession } from 'mongoose';
import OperationalAuditEntry from '@/models/OperationalAuditEntry';
import { auditOperation } from '@/modules/audit/operational-audit';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]),
  );
  return value;
}

export const commandFingerprint = (value: unknown) => JSON.stringify(canonical(value));

export function requiredManagementIdempotencyKey(value: string, code = 'IDEMPOTENCY_KEY_REQUIRED') {
  const key = String(value || '').trim();
  if (!key || key.length > 160) throw new Error(code);
  return key;
}

export async function loadCommandReplay<T>(input: {
  sportsClubId: string;
  idempotencyKey: string;
  command: string;
  payload: unknown;
  session: ClientSession;
  reusedCode?: string;
}) {
  const prior = await OperationalAuditEntry.findOne({ sportsClubId: input.sportsClubId, idempotencyKey: input.idempotencyKey }).session(input.session).lean();
  if (!prior) return undefined;
  if (prior.command !== input.command || (prior.after as any)?.inputFingerprint !== commandFingerprint(input.payload)) {
    throw new Error(input.reusedCode || 'IDEMPOTENCY_KEY_REUSED');
  }
  return (prior.after as any)?.result as T;
}

export async function recordCommandSuccess(input: {
  sportsClubId: string;
  arenaId?: string;
  actorUserId?: string;
  channel: 'app' | 'web' | 'kiosk' | 'system' | 'internal_api';
  command: string;
  targetType: string;
  targetId: string;
  idempotencyKey: string;
  payload: unknown;
  result: unknown;
  reason?: string;
  before?: Record<string, unknown>;
  session: ClientSession;
}) {
  await auditOperation({
    sportsClubId: input.sportsClubId,
    ...(input.arenaId ? { arenaId: input.arenaId } : {}),
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    channel: input.channel,
    command: input.command,
    targetType: input.targetType,
    targetId: input.targetId,
    result: 'succeeded',
    reason: input.reason,
    correlationId: input.idempotencyKey,
    idempotencyKey: input.idempotencyKey,
    ...(input.before ? { before: input.before } : {}),
    after: { inputFingerprint: commandFingerprint(input.payload), result: input.result },
  }, { session: input.session });
}
