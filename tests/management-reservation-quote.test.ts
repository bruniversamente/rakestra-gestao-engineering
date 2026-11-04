import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAcceptedReservationQuote, parseReservationPricePreview } from '../src/management-reservation-quote.ts';

const quote = { policyVersion: 'policy-1', totalCents: 1250, dueNowCents: 250, balanceAtVenueCents: 1000 };
const intent = { courtId: 'court-1', responsibleAssociationId: 'account-1', startsAt: '2026-10-30T10:00:00.000Z', endsAt: '2026-10-30T11:00:00.000Z' };

test('accepted reservation quotes preserve exact integer cents including zero', () => {
  assert.deepEqual(parseAcceptedReservationQuote(quote), quote);
  const zero = { ...quote, totalCents: 0, dueNowCents: 0, balanceAtVenueCents: 0 };
  assert.deepEqual(parseAcceptedReservationQuote(zero), zero);
});

test('reservation quotes reject inconsistent money, unknown fields and absent policy identity', () => {
  for (const patch of [{ totalCents: 1249 }, { dueNowCents: -1 }, { totalCents: 1.5 }, { dueNowCents: '250' }, { policyVersion: '' }, { extra: true }]) {
    assert.throws(() => parseAcceptedReservationQuote({ ...quote, ...patch }), /RESERVATION_QUOTE_INVALID/);
  }
});

test('price previews require matching scope, currency and mandatory revalidation', () => {
  const preview = { ...quote, ...intent, currency: 'BRL', evaluatedAt: '2026-10-29T00:00:00.000Z', requiresRevalidation: true };
  assert.equal(parseReservationPricePreview(preview, intent).totalCents, 1250);
  for (const patch of [{ courtId: 'other' }, { responsibleAssociationId: 'other' }, { startsAt: 'other' }, { endsAt: 'other' }, { currency: 'USD' }, { requiresRevalidation: false }, { evaluatedAt: 'invalid' }]) {
    assert.throws(() => parseReservationPricePreview({ ...preview, ...patch }, intent), /RESERVATION_PREVIEW_INVALID/);
  }
});
