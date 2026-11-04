import test from 'node:test';
import assert from 'node:assert/strict';
import { clearReceptionChargeIntent, readReceptionChargeIntent, readReservationChargeOrigin, receptionChargeHref } from '../src/management-reservation-charge.ts';
const club='100000000000000000000001',reservation='100000000000000000000002',invoice='100000000000000000000003',arena='100000000000000000000004',account='100000000000000000000005',payment='100000000000000000000006';
test('a reservation address reopens the same deposit without tab storage; session collection names its exact invoice',()=>{
 const url=new URL(receptionChargeHref(club,{reservationId:reservation,kind:'account_debt',invoiceId:invoice}),'https://local.invalid');assert.deepEqual(readReceptionChargeIntent(url.searchParams),{reservationId:reservation,kind:'account_debt',invoiceId:invoice});
 assert.deepEqual(readReceptionChargeIntent(new URLSearchParams({chargeReservationId:reservation})),{reservationId:reservation,kind:'reservation_deposit',invoiceId:undefined});
});
test('invalid or duplicate financial intent is not silently converted into a generic collection',()=>{
 for(const raw of['chargeReservationId=','chargeReservationId=other',`chargeReservationId=${reservation}&chargeKind=membership_invoice`,`chargeReservationId=${reservation}&chargeReservationId=${reservation}`,`chargeReservationId=${reservation}&chargeInvoiceId=`])assert.throws(()=>readReceptionChargeIntent(new URLSearchParams(raw)),/INTENT_INVALID/);
 assert.equal(readReceptionChargeIntent(new URLSearchParams({arenaId:arena})),null);
});
test('leaving an origin preserves unit, unrelated intent and fragment without retaining an old invoice',()=>{
 const url=new URL('https://local.invalid'+receptionChargeHref(club,{reservationId:reservation,kind:'account_debt',invoiceId:invoice,arenaId:arena}));url.searchParams.set('intent','keep');url.hash='recepcao';const next=new URL(clearReceptionChargeIntent(url),url);assert.equal(next.searchParams.get('arenaId'),arena);assert.equal(next.searchParams.get('intent'),'keep');assert.equal(next.hash,'#recepcao');assert(!next.searchParams.has('chargeReservationId')&&!next.searchParams.has('chargeInvoiceId')&&!next.searchParams.has('chargeKind'));
});
test('an origin read must name the requested club, reservation, kind, invoice and valid bounded amounts',()=>{
 const intent={reservationId:reservation,kind:'reservation_deposit' as const,invoiceId:invoice},value={sportsClubId:club,reservationId:reservation,arenaId:arena,accountId:account,invoiceId:invoice,origin:{kind:'reservation_deposit',referenceId:payment},label:'Reserva · sinal',amountCents:3000,dueCents:9000,invoiceStatus:'partially_paid',collectable:true,notCollectableReason:null};assert.equal(readReservationChargeOrigin(value,club,intent).amountCents,3000);
 for(const changed of[{sportsClubId:account},{reservationId:account},{invoiceId:account},{amountCents:10000},{amountCents:NaN},{origin:{kind:'guest_fee',referenceId:reservation}}])assert.throws(()=>readReservationChargeOrigin({...value,...changed},club,intent),/READ_INVALID/);
});

test('the stored method is an optional bounded suggestion and cannot introduce a provider or unknown method',()=>{
 const intent={reservationId:reservation,kind:'account_debt' as const,invoiceId:invoice},value={sportsClubId:club,reservationId:reservation,arenaId:arena,accountId:account,invoiceId:invoice,origin:{kind:'account_debt',referenceId:account},label:'Uso · recebimento',amountCents:5000,dueCents:5000,invoiceStatus:'open',collectable:true,notCollectableReason:null};for(const preferredMethod of['cash','pix','card'])assert.equal(readReservationChargeOrigin({...value,preferredMethod},club,intent).preferredMethod,preferredMethod);assert.equal(readReservationChargeOrigin(value,club,intent).preferredMethod,undefined);assert.throws(()=>readReservationChargeOrigin({...value,preferredMethod:'online_checkout'},club,intent),/READ_INVALID/);
});
