import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import OperationalAuditEntry from '@/models/OperationalAuditEntry';
import SportsClub from '@/models/SportsClub';
import Arena from '@/models/Arena';
import Court from '@/models/Court';
import { commandFingerprint } from '@/modules/operations/idempotent-command';

export class FacilityCommandError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly fields?: Record<string, string>) { super(code); }
}
export const facilityCommands = ['sports_club.update', 'arena.create', 'arena.update', 'court.create', 'court.update'] as const;
type FacilityCommand = typeof facilityCommands[number];
type Context = { key: string; sportsClubId: string; actorUserId: string; command: FacilityCommand; targetId: string; body: unknown; revision: string; needsPolicies: boolean; needsFacilities: boolean };
const validId = (value: string) => /^[a-f\d]{24}$/i.test(value);

/** The new web transport opts in explicitly; existing APP keys keep their old behavior. */
function parseKey(key: string, actorUserId: string) {
  const match = /^facility-v1:([a-f\d]{24}):([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}):(new|[a-f\d]{64})$/i.exec(key);
  if (!match) throw new FacilityCommandError('INVALID_FACILITY_COMMAND_KEY', 400);
  if (match[1] !== actorUserId) throw new FacilityCommandError('FACILITY_OPERATOR_CHANGED', 409);
  return match[3];
}
export function prepareFacilityCommand(request: Request, input: Omit<Context, 'key' | 'revision' | 'needsPolicies' | 'needsFacilities'> & { needsPolicies?: boolean; needsFacilities?: boolean }): Context | null {
  const key = request.headers.get('idempotency-key') || '';
  if (!key.startsWith('facility-v1:')) return null;
  const revision = parseKey(key, input.actorUserId);
  if (!validId(input.sportsClubId) || !validId(input.targetId) || !facilityCommands.includes(input.command) || (input.command.endsWith('.create') ? revision !== 'new' : revision === 'new')) throw new FacilityCommandError('INVALID_FACILITY_COMMAND_KEY', 400);
  return { ...input, key, revision, needsPolicies: !!input.needsPolicies, needsFacilities: input.needsFacilities !== false };
}
export function facilityRevision(resource: { toObject?: () => unknown } | unknown) {
  const value = resource && typeof resource === 'object' && 'toObject' in resource && typeof resource.toObject === 'function' ? resource.toObject() : resource;
  return createHash('sha256').update(commandFingerprint(JSON.parse(JSON.stringify(value)))).digest('hex');
}
export function assertFacilityRevision(context: Context | null, resource: unknown) {
  if (context && context.revision !== facilityRevision(resource)) throw new FacilityCommandError('FACILITY_STATE_CHANGED', 409);
}
const fingerprint = (context: Context) => commandFingerprint({ actorUserId: context.actorUserId, command: context.command, targetId: context.targetId, body: context.body });
export async function replayFacilityCommand(context: Context | null, session: ClientSession): Promise<Record<string, unknown> | null> {
  if (!context) return null;
  const audit = await OperationalAuditEntry.findOne({ sportsClubId: context.sportsClubId, idempotencyKey: context.key }).session(session).lean();
  if (!audit) return null;
  const metadata = audit.after?.facilityCommand as { inputFingerprint?: unknown; result?: Record<string, unknown> } | undefined;
  if (String(audit.actorUserId) !== context.actorUserId || audit.command !== context.command || audit.result !== 'succeeded' || metadata?.inputFingerprint !== fingerprint(context)) throw new FacilityCommandError('IDEMPOTENCY_KEY_REUSED', 409);
  const receipt = metadata?.result;
  if (!receipt || !validId(String(receipt._id || '')) || receipt._id !== audit.targetId) throw new FacilityCommandError('FACILITY_COMMAND_RESULT_INVALID', 500);
  return receipt;
}
export function facilityAuditFields(context: Context | null, after: Record<string, unknown>, result: Record<string, unknown>) {
  return context ? { idempotencyKey: context.key, correlationId: context.key, after: { ...after, facilityCommand: { inputFingerprint: fingerprint(context), needsPolicies: context.needsPolicies, needsFacilities: context.needsFacilities, result } } } : {};
}
export function facilityRecoveryError(error: unknown, request: Request) {
  // A concurrent command may have won the unique audit key. Its receipt must be
  // consulted before deciding that the write failed or issuing another command.
  return request.headers.get('idempotency-key')?.startsWith('facility-v1:') && error && typeof error === 'object' && 'code' in error && error.code === 11000 ? new FacilityCommandError('FACILITY_COMMAND_UNCONFIRMED', 503) : error;
}
export async function readFacilityCommandResult(sportsClubId: string, actorUserId: string, key: string) {
  const { getStaffAccess } = await import('./staff-permissions');
  parseKey(key, actorUserId);
  if (!validId(sportsClubId)) throw new FacilityCommandError('SPORTS_CLUB_NOT_FOUND', 404);
  const access = await getStaffAccess({ sportsClubId, userId: actorUserId, permission: 'manage_facilities' });
  const policyAccess = await getStaffAccess({ sportsClubId, userId: actorUserId, permission: 'manage_policies' });
  if (!access.allowed && !policyAccess.allowed) throw new FacilityCommandError(access.code, access.code === 'SPORTS_CLUB_NOT_FOUND' ? 404 : 403);
  if (!access.allowed && policyAccess.allowed && policyAccess.allowedArenaIds !== null) throw new FacilityCommandError('STAFF_UNIT_SCOPE_DENIED', 403);
  const audit = await OperationalAuditEntry.findOne({ sportsClubId, actorUserId, idempotencyKey: key, result: 'succeeded', command: { $in: facilityCommands } }).lean();
  if (!audit) return { status: 'unknown' as const };
  const metadata = audit.after?.facilityCommand as { inputFingerprint?: unknown; needsPolicies?: unknown; needsFacilities?: unknown; result?: Record<string, unknown> } | undefined, receipt = metadata?.result;
  if (!receipt || typeof receipt._id !== 'string' || !validId(receipt._id) || receipt._id !== audit.targetId || typeof metadata.inputFingerprint !== 'string' || typeof metadata.needsPolicies !== 'boolean') throw new FacilityCommandError('FACILITY_COMMAND_RESULT_INVALID', 500);
  if (audit.command === 'sports_club.update') {
    if (audit.targetType !== 'sports_club') throw new FacilityCommandError('FACILITY_COMMAND_RESULT_INVALID', 500);
    // Receipts created before this marker conservatively retain facility permission.
    if (metadata.needsFacilities !== undefined && typeof metadata.needsFacilities !== 'boolean') throw new FacilityCommandError('FACILITY_COMMAND_RESULT_INVALID', 500);
    const needsFacilities = metadata.needsFacilities !== false;
    if (!needsFacilities && !metadata.needsPolicies) throw new FacilityCommandError('FACILITY_COMMAND_RESULT_INVALID', 500);
    if (needsFacilities && !access.allowed) throw new FacilityCommandError(access.code, 403);
    if (needsFacilities && access.allowed && access.allowedArenaIds !== null) throw new FacilityCommandError('STAFF_UNIT_SCOPE_DENIED', 403);
    if (metadata.needsPolicies && (!policyAccess.allowed || policyAccess.allowedArenaIds !== null)) throw new FacilityCommandError('STAFF_PERMISSION_DENIED', 403);
    if (receipt._id !== sportsClubId || !await SportsClub.exists({ _id: receipt._id })) throw new FacilityCommandError('FACILITY_COMMAND_RESULT_INVALID', 500);
  } else {
    if (!access.allowed) throw new FacilityCommandError(access.code, 403);
    const arena = audit.command.startsWith('arena.');
    const resource = arena ? await Arena.findOne({ _id: receipt._id, sportsClubId }).select('_id').lean() : await Court.findOne({ _id: receipt._id, sportsClubId }).select('arenaId').lean();
    if (!resource || (arena ? audit.targetType !== 'arena' : audit.targetType !== 'court')) throw new FacilityCommandError('FACILITY_COMMAND_RESULT_INVALID', 500);
    const arenaId = arena ? receipt._id : String('arenaId' in resource ? resource.arenaId : '');
    if (String(audit.arenaId) !== arenaId) throw new FacilityCommandError('FACILITY_COMMAND_RESULT_INVALID', 500);
    if (access.allowedArenaIds !== null && !access.allowedArenaIds.includes(arenaId)) throw new FacilityCommandError('STAFF_UNIT_SCOPE_DENIED', 403);
  }
  return { status: 'confirmed' as const, receipt: { id: receipt._id, command: audit.command } };
}
