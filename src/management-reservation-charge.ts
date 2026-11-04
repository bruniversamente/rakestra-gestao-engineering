import { RESERVATION_CHARGE_ORIGIN_KINDS, type ReservationChargeOrigin, type ReservationChargeOriginKind } from './management-reservation-charge-origin.ts';

const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
export function readReceptionChargeIntent(query: Pick<URLSearchParams,'get'|'has'|'getAll'>) {
  if (!query.has('chargeReservationId')) return null;
  const reservationId=query.get('chargeReservationId')||'',kind=query.has('chargeKind')?query.get('chargeKind')!:'reservation_deposit',invoiceId=query.has('chargeInvoiceId')?query.get('chargeInvoiceId')!:undefined;
  if (!id(reservationId)||(invoiceId!==undefined&&!id(invoiceId))||!(RESERVATION_CHARGE_ORIGIN_KINDS as readonly string[]).includes(kind)||['chargeReservationId','chargeKind','chargeInvoiceId'].some(key=>query.getAll(key).length>1)) throw Error('RECEPTION_CHARGE_INTENT_INVALID');
  return {reservationId,kind:kind as ReservationChargeOriginKind,invoiceId};
}
export function receptionChargeHref(clubId:string,input:{reservationId:string;kind:ReservationChargeOriginKind;invoiceId?:string;arenaId?:string}) {
  const query=new URLSearchParams({section:'cobranca',chargeReservationId:input.reservationId,chargeKind:input.kind});
  if(input.invoiceId)query.set('chargeInvoiceId',input.invoiceId);if(input.arenaId)query.set('arenaId',input.arenaId);
  return `/gestao/clubes/${encodeURIComponent(clubId)}/recepcao?${query}`;
}
export function clearReceptionChargeIntent(url:URL) {const next=new URL(url);for(const key of['chargeReservationId','chargeKind','chargeInvoiceId'])next.searchParams.delete(key);return next.pathname+next.search+next.hash;}
export function readReservationChargeOrigin(value:unknown,clubId:string,intent:NonNullable<ReturnType<typeof readReceptionChargeIntent>>):ReservationChargeOrigin {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('RECEPTION_CHARGE_READ_INVALID');
  const row=value as ReservationChargeOrigin;
  if (row.preferredMethod!==undefined&&!['cash','pix','card'].includes(row.preferredMethod)) throw Error('RECEPTION_CHARGE_READ_INVALID');
  if(row.sportsClubId!==clubId||row.reservationId!==intent.reservationId||row.origin?.kind!==intent.kind||(intent.invoiceId&&row.invoiceId!==intent.invoiceId)||![row.arenaId,row.accountId,row.invoiceId,row.origin?.referenceId].every(id)||typeof row.label!=='string'||!Number.isSafeInteger(row.dueCents)||row.dueCents<0||typeof row.invoiceStatus!=='string'||typeof row.collectable!=='boolean'||!(row.amountCents===null&&row.origin.kind==='guest_fee'||Number.isSafeInteger(row.amountCents)&&row.amountCents!==null&&row.amountCents>=0&&row.amountCents<=row.dueCents)||![null,'reservation_cancelled','invoice_uncollectable','origin_settled'].includes(row.notCollectableReason)||row.collectable!==(row.notCollectableReason===null)||row.collectable&&row.dueCents<=0)throw Error('RECEPTION_CHARGE_READ_INVALID');
  if(row.origin.kind==='account_debt'&&row.origin.referenceId!==row.accountId||row.origin.kind==='guest_fee'&&row.origin.referenceId!==row.reservationId)throw Error('RECEPTION_CHARGE_READ_INVALID');
  return row;
}
