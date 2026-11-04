import mongoose, { type ClientSession } from 'mongoose';
import { NextResponse } from 'next/server';
import Arena from '@/models/Arena';
import ClubOrganization from '@/models/ClubOrganization';
import OrganizationStaffAssignment, {
  type OrganizationStaffRole,
} from '@/models/OrganizationStaffAssignment';
import SportsClub from '@/models/SportsClub';
import StaffAssignment from '@/models/StaffAssignment';
import {
  requireClubCapability,
  resolveClubCapabilities,
} from '@/modules/clubs/capability-service';
import type { ClubCapability } from '@/modules/clubs/capability-contracts';
import { assertClubCapabilityRuntimeReady } from '@/modules/clubs/capability-readiness';

export const CLUB_PERMISSIONS = [
  'view_calendar', 'manage_reservations', 'override_policy', 'record_check_in',
  'operate_queue', 'operate_sessions', 'block_court', 'manage_facilities',
  'manage_memberships', 'record_manual_payment', 'refund_payments',
  'view_finance', 'manage_billing', 'view_reports', 'manage_policies', 'manage_staff',
  'manage_documents', 'manage_access', 'view_access_events', 'manage_kiosks', 'manage_displays', 'view_rankings', 'manage_rankings', 'manage_packages', 'manage_stringing',
  'view_tournaments', 'manage_tournaments', 'manage_tournament_results',
  'manage_communications', 'manage_brand', 'manage_integrations', 'manage_payment_settings',
  'view_instruction', 'manage_instruction_catalog', 'manage_instruction_roster',
  'manage_instruction_schedule', 'record_instruction_attendance', 'view_instruction_finance',
] as const;

export type ClubPermission = typeof CLUB_PERMISSIONS[number];

export const PERMISSION_CAPABILITY_REQUIREMENTS: Readonly<Partial<Record<ClubPermission, ClubCapability>>> = {
  view_calendar: 'reservations',
  manage_reservations: 'reservations',
  override_policy: 'reservations',
  record_check_in: 'reservations',
  operate_queue: 'reservations',
  operate_sessions: 'reservations',
  block_court: 'reservations',
  manage_policies: 'reservations',
  manage_memberships: 'memberships',
  record_manual_payment: 'billing',
  refund_payments: 'billing',
  view_finance: 'billing',
  manage_billing: 'billing',
  view_reports: 'reports',
  manage_documents: 'waivers',
  manage_access: 'access_control',
  view_access_events: 'access_control',
  manage_kiosks: 'kiosk',
  manage_displays: 'kiosk',
  view_tournaments: 'tournaments',
  manage_tournaments: 'tournaments',
  manage_tournament_results: 'tournaments',
  view_rankings: 'leagues',
  manage_rankings: 'leagues',
  manage_packages: 'packages',
  manage_stringing: 'stringing',
  manage_communications: 'communications',
  manage_brand: 'custom_brand',
  manage_payment_settings: 'billing',
  view_instruction: 'instruction',
  manage_instruction_catalog: 'instruction',
  manage_instruction_roster: 'instruction',
  manage_instruction_schedule: 'instruction',
  record_instruction_attendance: 'instruction',
  view_instruction_finance: 'instruction',
};
export type StaffRole = 'owner' | 'operations_manager' | 'reception' | 'finance' | 'viewer';
export type StaffAccess =
  | {
    allowed: true;
    role: StaffRole;
    isActualOwner: boolean;
    permissions: ClubPermission[];
    allowedArenaIds: string[] | null;
  }
  | {
    allowed: false;
    code: 'SPORTS_CLUB_NOT_FOUND' | 'CLUB_PERMISSION_DENIED' | 'CLUB_CAPABILITY_UNAVAILABLE' | 'CLUB_CAPABILITY_NOT_ENABLED' | 'CLUB_CAPABILITY_NOT_RELEASED' | 'CLUB_CAPABILITY_NOT_READY' | 'STAFF_ASSIGNMENT_NOT_ACTIVE' | 'STAFF_ASSIGNMENT_OUTSIDE_EFFECTIVE_PERIOD' | 'STAFF_UNIT_SCOPE_DENIED';
    readinessReasonCode?: string;
    isActualOwner: false;
  };

export type GrantedStaffAccess = Extract<StaffAccess, { allowed: true }>;

export function assertStaffArenaAccess(access: GrantedStaffAccess, arenaId: string) {
  if (access.allowedArenaIds !== null && !access.allowedArenaIds.includes(String(arenaId))) {
    throw new Error('STAFF_UNIT_SCOPE_DENIED');
  }
}

export const ROLE_PERMISSIONS: Record<StaffRole, ClubPermission[]> = {
  owner: [...CLUB_PERMISSIONS],
  operations_manager: CLUB_PERMISSIONS.filter((permission) => permission !== 'manage_staff'),
  reception: [
    'view_calendar', 'manage_reservations', 'record_check_in', 'operate_queue', 'operate_sessions',
    'view_access_events', 'manage_kiosks', 'record_manual_payment',
    'view_instruction',
  ],
  finance: [
    'view_tournaments',
    'view_calendar', 'record_manual_payment', 'refund_payments',
    'view_finance', 'manage_billing', 'view_reports', 'view_instruction', 'view_instruction_finance',
  ],
  viewer: ['view_tournaments','view_rankings','view_calendar', 'view_instruction'],
};

export function resolveEffectivePermissions(role: StaffRole, extras: ClubPermission[]) {
  const known = new Set<ClubPermission>(CLUB_PERMISSIONS);
  const permissions = new Set<ClubPermission>([
    ...ROLE_PERMISSIONS[role],
    ...extras.filter((item) => known.has(item)),
  ]);
  if (permissions.has('manage_tournaments') || permissions.has('manage_tournament_results')) permissions.add('view_tournaments');
  return permissions;
}

const allowedAccess = (
  role: StaffRole,
  isActualOwner: boolean,
  permissions: ReadonlySet<ClubPermission>,
  allowedArenaIds: string[] | null,
): StaffAccess => ({
  allowed: true,
  role,
  isActualOwner,
  permissions: Array.from(permissions),
  allowedArenaIds,
});

export function mapOrganizationStaffRole(role: OrganizationStaffRole): StaffRole {
  if (role === 'finance') return 'finance';
  if (role === 'viewer') return 'viewer';
  return 'operations_manager';
}

export async function getStaffAccess(input: {
  sportsClubId: string;
  userId: string;
  permission: ClubPermission;
  organizationId?: string;
  arenaId?: string;
}, options: { session?: ClientSession } = {}): Promise<StaffAccess> {
  if (!mongoose.isValidObjectId(input.sportsClubId)) {
    return { allowed: false, code: 'SPORTS_CLUB_NOT_FOUND', isActualOwner: false };
  }
  if (!mongoose.isValidObjectId(input.userId)) {
    return { allowed: false, code: 'CLUB_PERMISSION_DENIED', isActualOwner: false };
  }
  if (input.organizationId && !mongoose.isValidObjectId(input.organizationId)) {
    return { allowed: false, code: 'STAFF_UNIT_SCOPE_DENIED', isActualOwner: false };
  }
  const clubQuery = SportsClub.findById(input.sportsClubId)
    .select('organizationId ownerUserId profileType operatingProfile');
  if (options.session) clubQuery.session(options.session);
  const club = await clubQuery.lean();
  if (!club) return { allowed: false, code: 'SPORTS_CLUB_NOT_FOUND', isActualOwner: false };
  if (
    input.organizationId
    && String(club.organizationId || '') !== input.organizationId
  ) {
    return { allowed: false, code: 'STAFF_UNIT_SCOPE_DENIED', isActualOwner: false };
  }
  if (input.arenaId) {
    if (!mongoose.isValidObjectId(input.arenaId)) {
      return { allowed: false, code: 'STAFF_UNIT_SCOPE_DENIED', isActualOwner: false };
    }
    const arenaQuery = Arena.exists({
      _id: input.arenaId,
      sportsClubId: input.sportsClubId,
    });
    if (options.session) arenaQuery.session(options.session);
    if (!await arenaQuery) {
      return { allowed: false, code: 'STAFF_UNIT_SCOPE_DENIED', isActualOwner: false };
    }
  }
  if (input.permission === 'manage_memberships' && !resolveClubCapabilities(club).has('memberships')) {
    return { allowed: false, code: 'CLUB_CAPABILITY_UNAVAILABLE', isActualOwner: false };
  }
  const isActualOwner = String(club.ownerUserId) === input.userId;
  if (isActualOwner) {
    return allowedAccess('owner', true, new Set(CLUB_PERMISSIONS), null);
  }

  let organizationActive = false;
  if (club.organizationId) {
    const organizationQuery = ClubOrganization.findById(club.organizationId)
      .select('ownerUserId status');
    if (options.session) organizationQuery.session(options.session);
    const organization = await organizationQuery.lean();
    organizationActive = organization?.status === 'active';
    if (
      organization?.status === 'active'
      && String(organization.ownerUserId) === input.userId
    ) {
      return allowedAccess('owner', false, new Set(CLUB_PERMISSIONS), null);
    }
  }

  const assignmentQuery = StaffAssignment.findOne({
    sportsClubId: input.sportsClubId,
    userId: input.userId,
  });
  if (options.session) assignmentQuery.session(options.session);
  const assignment = await assignmentQuery.lean();

  const now = new Date();
  if (assignment) {
    if (assignment.role === 'owner') {
      return { allowed: false, code: 'CLUB_PERMISSION_DENIED', isActualOwner: false };
    }
    if (assignment.status !== 'active') {
      return { allowed: false, code: 'STAFF_ASSIGNMENT_NOT_ACTIVE', isActualOwner: false };
    }
    if (
      (assignment.effectiveFrom && new Date(assignment.effectiveFrom) > now)
      || (assignment.effectiveUntil && new Date(assignment.effectiveUntil) < now)
    ) {
      return {
        allowed: false,
        code: 'STAFF_ASSIGNMENT_OUTSIDE_EFFECTIVE_PERIOD',
        isActualOwner: false,
      };
    }
    if (
      input.arenaId
      && (assignment.arenaIds || []).length > 0
      && !(assignment.arenaIds || []).some(
        (arenaId) => String(arenaId) === input.arenaId,
      )
    ) {
      return { allowed: false, code: 'STAFF_UNIT_SCOPE_DENIED', isActualOwner: false };
    }
    const permissions = resolveEffectivePermissions(
      assignment.role,
      assignment.extraPermissions || [],
    );
    return (permissions.has(input.permission) || (input.permission === 'view_rankings' && permissions.has('manage_rankings')))
      ? allowedAccess(
        assignment.role,
        false,
        permissions,
        (assignment.arenaIds || []).length > 0
          ? assignment.arenaIds.map(String)
          : null,
      )
      : { allowed: false, code: 'CLUB_PERMISSION_DENIED', isActualOwner: false };
  }

  if (!club.organizationId || !organizationActive) {
    return { allowed: false, code: 'CLUB_PERMISSION_DENIED', isActualOwner: false };
  }
  const organizationAssignmentQuery = OrganizationStaffAssignment.findOne({
    organizationId: club.organizationId,
    userId: input.userId,
  });
  if (options.session) organizationAssignmentQuery.session(options.session);
  const organizationAssignment = await organizationAssignmentQuery.lean();
  if (!organizationAssignment) {
    return { allowed: false, code: 'CLUB_PERMISSION_DENIED', isActualOwner: false };
  }
  if (organizationAssignment.status !== 'active') {
    return { allowed: false, code: 'STAFF_ASSIGNMENT_NOT_ACTIVE', isActualOwner: false };
  }
  if (
    organizationAssignment.effectiveFrom > now
    || (
      organizationAssignment.effectiveUntil
      && organizationAssignment.effectiveUntil < now
    )
  ) {
    return {
      allowed: false,
      code: 'STAFF_ASSIGNMENT_OUTSIDE_EFFECTIVE_PERIOD',
      isActualOwner: false,
    };
  }
  const organizationAdmin = organizationAssignment.role === 'organization_admin';
  const sportsClubScope = organizationAssignment.sportsClubIds.map(String);
  const arenaScope = organizationAssignment.arenaIds.map(String);
  const scopedArenaIds = organizationAdmin || arenaScope.length === 0
    ? []
    : (await Arena.find({
      _id: { $in: arenaScope },
      sportsClubId: input.sportsClubId,
    }).select('_id').session(options.session || null).lean()).map((arena) => String(arena._id));
  if (!organizationAdmin) {
    if (sportsClubScope.length === 0 && arenaScope.length === 0) {
      return { allowed: false, code: 'STAFF_UNIT_SCOPE_DENIED', isActualOwner: false };
    }
    if (sportsClubScope.length > 0 && !sportsClubScope.includes(input.sportsClubId)) {
      return { allowed: false, code: 'STAFF_UNIT_SCOPE_DENIED', isActualOwner: false };
    }
    if (sportsClubScope.length === 0 && scopedArenaIds.length === 0) {
      return { allowed: false, code: 'STAFF_UNIT_SCOPE_DENIED', isActualOwner: false };
    }
    if (
      input.arenaId
      && arenaScope.length > 0
      && !arenaScope.includes(input.arenaId)
    ) {
      return { allowed: false, code: 'STAFF_UNIT_SCOPE_DENIED', isActualOwner: false };
    }
  }
  const mappedRole = mapOrganizationStaffRole(organizationAssignment.role);
  const organizationPermissions = organizationAdmin
    ? new Set<ClubPermission>(CLUB_PERMISSIONS)
    : resolveEffectivePermissions(mappedRole, []);
  return (organizationPermissions.has(input.permission) || (input.permission === 'view_rankings' && organizationPermissions.has('manage_rankings')))
    ? allowedAccess(
      mappedRole,
      false,
      organizationPermissions,
      organizationAdmin || arenaScope.length === 0 ? null : scopedArenaIds,
    )
    : { allowed: false, code: 'CLUB_PERMISSION_DENIED', isActualOwner: false };
}

/**
 * Authorizes a concrete club operation. Unlike getStaffAccess, this boundary
 * also proves that the commercial capability is contracted and operationally
 * released. Keep getStaffAccess capability-neutral for coarse staff/authority
 * discovery on the management shell.
 */
export async function getClubOperationAccess(input: {
  sportsClubId: string;
  userId: string;
  permission: ClubPermission;
  capability?: ClubCapability;
  organizationId?: string;
  arenaId?: string;
  clubWide?: boolean;
}, options: { session?: ClientSession } = {}): Promise<StaffAccess> {
  const requiredCapability = input.capability
    || PERMISSION_CAPABILITY_REQUIREMENTS[input.permission]
    || null;
  if (requiredCapability) {
    try {
      await requireClubCapability({
        clubId: input.sportsClubId,
        capability: requiredCapability,
        session: options.session,
      });
      await assertClubCapabilityRuntimeReady({ clubId: input.sportsClubId, capability: requiredCapability, session: options.session });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'CLUB_CAPABILITY_NOT_ENABLED';
      if (code === 'SPORTS_CLUB_NOT_FOUND') {
        return { allowed: false, code, isActualOwner: false };
      }
      return {
        allowed: false,
        code: code === 'CLUB_CAPABILITY_NOT_RELEASED'
          ? 'CLUB_CAPABILITY_NOT_RELEASED'
          : code === 'CLUB_CAPABILITY_NOT_ENABLED'
            ? 'CLUB_CAPABILITY_NOT_ENABLED'
            : 'CLUB_CAPABILITY_NOT_READY',
        ...(code !== 'CLUB_CAPABILITY_NOT_RELEASED' && code !== 'CLUB_CAPABILITY_NOT_ENABLED' ? { readinessReasonCode: code } : {}),
        isActualOwner: false,
      };
    }
  }

  const access = await getStaffAccess({
    sportsClubId: input.sportsClubId,
    userId: input.userId,
    permission: input.permission,
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    ...(input.arenaId ? { arenaId: input.arenaId } : {}),
  }, options);
  if (
    access.allowed
    && access.allowedArenaIds !== null
    && (
      input.clubWide === true
      || input.permission === 'manage_memberships'
      || input.permission === 'manage_brand'
    )
  ) {
    return { allowed: false, code: 'STAFF_UNIT_SCOPE_DENIED', isActualOwner: false };
  }
  return access;
}

export async function requireSportsClubPermission(
  request: Request,
  sportsClubId: string,
  permission: ClubPermission,
  scope: { arenaId?: string; clubWide?: boolean } = {},
) {
  const { requireAuthenticatedUser } = await import('@/lib/acting-mode');
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth;

  const access = await getClubOperationAccess({
    sportsClubId,
    userId: String(auth.userId),
    permission,
    ...(scope.arenaId ? { arenaId: scope.arenaId } : {}),
    ...(scope.clubWide ? { clubWide: true } : {}),
  });
  if (!access.allowed) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: access.code, ...(access.readinessReasonCode ? { reasonCode: access.readinessReasonCode } : {}) },
        { status: access.code === 'SPORTS_CLUB_NOT_FOUND' ? 404 : 403 },
      ),
    };
  }

  return {
    ok: true as const,
    userId: String(auth.userId),
    role: access.role,
    isActualOwner: access.isActualOwner,
    permissions: access.permissions,
    allowedArenaIds: access.allowedArenaIds,
  };
}
