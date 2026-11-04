export const RESERVATION_CHARGE_ORIGIN_KINDS = [
  'reservation_deposit', 'reservation_balance', 'guest_fee', 'account_debt',
] as const;
export type ReservationChargeOriginKind = typeof RESERVATION_CHARGE_ORIGIN_KINDS[number];
export type ReservationChargeOrigin = {
  sportsClubId: string;
  reservationId: string;
  arenaId: string;
  accountId: string;
  invoiceId: string;
  origin: { kind: ReservationChargeOriginKind; referenceId: string };
  label: string;
  amountCents: number | null;
  dueCents: number;
  invoiceStatus: string;
  preferredMethod?: 'cash' | 'pix' | 'card';
  collectable: boolean;
  notCollectableReason: 'reservation_cancelled' | 'invoice_uncollectable' | 'origin_settled' | null;
};
