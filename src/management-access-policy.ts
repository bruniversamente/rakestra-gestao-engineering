export type ManagementAccessClub = {
  capabilities?: readonly string[];
  operationalCapabilities?: Record<string, { commercialEnabled: boolean; available: boolean; reasonCode?: string }>;
  authority?: { permissions: readonly string[]; allowedArenaIds: readonly string[] | null };
};

export type ManagementRouteDenialReason =
  | 'route_unmapped'
  | 'capability_not_contracted'
  | 'capability_not_released'
  | 'permission_denied'
  | 'arena_scope_denied';

export type ManagementRouteAccess =
  | { allowed: true; section: string }
  | {
    allowed: false;
    section: string;
    reason: ManagementRouteDenialReason;
    capability?: string;
    permission?: string;
    detailCode?: string;
  };

type RouteRequirement = {
  section: string;
  capability?: string;
  permissions?: readonly string[];
  permissionMode?: 'all' | 'any';
};

const ROUTE_REQUIREMENTS: Record<string, RouteRequirement> = {
  agenda: { section: 'Reservas', capability: 'reservations', permissions: ['view_calendar'] },
  reservas: { section: 'Reservas', capability: 'reservations', permissions: ['view_calendar'] },
  aulas: { section: 'Aulas', capability: 'instruction', permissions: ['view_instruction'] },
  relatorios: { section: 'Relatórios', capability: 'reports', permissions: ['view_reports'] },
  recepcao: { section: 'Recepção', capability: 'reservations', permissions: ['record_check_in', 'operate_sessions'], permissionMode: 'any' },
  associacoes: { section: 'Sócios', capability: 'memberships', permissions: ['manage_memberships'] },
  documentos: { section: 'Documentos', capability: 'waivers', permissions: ['manage_documents'] },
  marca: { section: 'Site de reservas', capability: 'custom_brand', permissions: ['manage_brand'] },
  pacotes: { section: 'Pacotes', capability: 'packages', permissions: ['manage_packages'] },
  financeiro: { section: 'Financeiro', capability: 'billing', permissions: ['view_finance'] },
  'financeiro/recebimentos': { section: 'Recebimentos', capability: 'billing', permissions: ['view_finance', 'record_manual_payment'], permissionMode: 'any' },
  'financeiro/pacotes': { section: 'Pacotes', capability: 'packages', permissions: ['manage_packages'] },
  'financeiro/configuracoes': { section: 'Configurações financeiras', capability: 'billing', permissions: ['manage_payment_settings'] },
  encordoamento: { section: 'Encordoamento', capability: 'stringing', permissions: ['manage_stringing'] },
  comunicacoes: { section: 'Comunicações', capability: 'communications', permissions: ['manage_communications'] },
  'ranking-interno': { section: 'Ranking interno', capability: 'leagues', permissions: ['view_rankings', 'manage_rankings'], permissionMode: 'any' },
  torneios: { section: 'Torneios', capability: 'tournaments', permissions: ['view_tournaments', 'manage_tournaments', 'manage_tournament_results'], permissionMode: 'any' },
  competicoes: { section: 'Ranking interno', capability: 'leagues', permissions: ['view_rankings', 'manage_rankings'], permissionMode: 'any' },
  cobrancas: { section: 'Cobranças', capability: 'billing', permissions: ['view_finance'] },
  pos: { section: 'Ponto de venda', capability: 'point_of_sale', permissions: ['record_manual_payment'] },
  pagamentos: { section: 'Pagamentos', capability: 'billing', permissions: ['view_finance'] },
  telas: { section: 'Telas', capability: 'kiosk', permissions: ['manage_displays'] },
  'regras-de-reserva': { section: 'Regras de reserva', capability: 'reservations', permissions: ['manage_policies'] },
  configuracao: { section: 'Configuração', permissions: ['manage_facilities', 'manage_policies', 'manage_payment_settings'], permissionMode: 'any' },
  equipe: { section: 'Equipe', permissions: ['manage_staff'] },
};

const routeSection = (pathname: string, clubId: string) => {
  const prefix = `/gestao/clubes/${clubId}`;
  if (pathname === prefix || pathname === `${prefix}/`) return '';
  if (!pathname.startsWith(`${prefix}/`)) return null;
  const parts = pathname.slice(prefix.length + 1).split('/').filter(Boolean);
  if (parts[0] === 'financeiro' && parts[1]) return `financeiro/${parts[1]}`;
  return parts[0] || '';
};

export function resolveManagementRouteAccess(input: {
  pathname: string;
  clubId: string;
  club: ManagementAccessClub;
  requestedArenaId?: string | null;
}): ManagementRouteAccess {
  const sectionKey = routeSection(input.pathname, input.clubId);
  if (sectionKey === '') return { allowed: true, section: 'Visão geral' };
  const requirement = sectionKey === null ? undefined : ROUTE_REQUIREMENTS[sectionKey];
  if (!requirement) return { allowed: false, section: 'Gestão', reason: 'route_unmapped' };

  if (requirement.capability) {
    const operational = input.club.operationalCapabilities?.[requirement.capability];
    const contracted = input.club.capabilities?.includes(requirement.capability) === true
      && operational?.commercialEnabled === true;
    if (!contracted) {
      return {
        allowed: false,
        section: requirement.section,
        reason: 'capability_not_contracted',
        capability: requirement.capability,
        detailCode: operational?.reasonCode,
      };
    }
    if (operational.available !== true) {
      return {
        allowed: false,
        section: requirement.section,
        reason: 'capability_not_released',
        capability: requirement.capability,
        detailCode: operational.reasonCode,
      };
    }
  }

  const permissions = new Set(input.club.authority?.permissions || []);
  const requiredPermissions = requirement.permissions || [];
  const permissionAllowed = requirement.permissionMode === 'any'
    ? requiredPermissions.some((permission) => permissions.has(permission))
    : requiredPermissions.every((permission) => permissions.has(permission));
  if (!permissionAllowed) {
    return {
      allowed: false,
      section: requirement.section,
      reason: 'permission_denied',
      permission: requiredPermissions.join(requirement.permissionMode === 'any' ? '|' : '&'),
    };
  }

  const requestedArenaId = String(input.requestedArenaId || '').trim();
  const allowedArenaIds = input.club.authority?.allowedArenaIds;
  if (requestedArenaId && Array.isArray(allowedArenaIds) && !allowedArenaIds.includes(requestedArenaId)) {
    return { allowed: false, section: requirement.section, reason: 'arena_scope_denied' };
  }

  return { allowed: true, section: requirement.section };
}

export const managementRouteRequirements = ROUTE_REQUIREMENTS;
