export type AcceptedReservationQuote = {
  policyVersion: string;
  totalCents: number;
  dueNowCents: number;
  balanceAtVenueCents: number;
};

export type ReservationPreviewInput = {
  courtId: string; responsibleAssociationId: string; startsAt: string; endsAt: string;
};
export type ReservationPricePreview = AcceptedReservationQuote & ReservationPreviewInput & {
  currency: 'BRL'; evaluatedAt: string; requiresRevalidation: true;
};

export function parseReservationPricePreview(value: unknown, intent: ReservationPreviewInput): ReservationPricePreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RESERVATION_PREVIEW_INVALID');
  const record = value as Record<string, unknown>;
  const accepted = parseAcceptedReservationQuote({ policyVersion: record.policyVersion, totalCents: record.totalCents, dueNowCents: record.dueNowCents, balanceAtVenueCents: record.balanceAtVenueCents });
  if (record.courtId !== intent.courtId || record.responsibleAssociationId !== intent.responsibleAssociationId
    || record.startsAt !== intent.startsAt || record.endsAt !== intent.endsAt
    || record.currency !== 'BRL' || record.requiresRevalidation !== true
    || typeof record.evaluatedAt !== 'string' || !Number.isFinite(Date.parse(record.evaluatedAt))) throw new Error('RESERVATION_PREVIEW_INVALID');
  return { ...accepted, ...intent, currency: 'BRL', evaluatedAt: record.evaluatedAt, requiresRevalidation: true };
}

export function parseAcceptedReservationQuote(value: unknown): AcceptedReservationQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RESERVATION_QUOTE_INVALID');
  const record = value as Record<string, unknown>;
  const keys = ['policyVersion', 'totalCents', 'dueNowCents', 'balanceAtVenueCents'];
  if (Object.keys(record).length !== keys.length || Object.keys(record).some(key => !keys.includes(key))
    || typeof record.policyVersion !== 'string' || !record.policyVersion.trim() || record.policyVersion.length > 512
    || keys.slice(1).some(key => !Number.isSafeInteger(record[key]) || (record[key] as number) < 0)
    || record.totalCents !== (record.dueNowCents as number) + (record.balanceAtVenueCents as number)) throw new Error('RESERVATION_QUOTE_INVALID');
  return { policyVersion: record.policyVersion, totalCents: record.totalCents as number, dueNowCents: record.dueNowCents as number, balanceAtVenueCents: record.balanceAtVenueCents as number };
}
