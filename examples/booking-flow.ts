import { getAvailableScheduleCourtIds } from '../src/management-schedule-availability.ts';
import { parseAcceptedReservationQuote } from '../src/management-reservation-quote.ts';
import { resolveManagementRouteAccess } from '../src/management-access-policy.ts';

// Fictitious data, in memory. This example sends no request and records no booking.
const courts=[{id:'court-a',status:'active'},{id:'court-b',status:'active'}];
const available=getAvailableScheduleCourtIds({courts,events:[{courtId:'court-a',localDate:'2026-11-04',startMinute:600,endMinute:660}],localDate:'2026-11-04',startMinute:600});
const quote=parseAcceptedReservationQuote({policyVersion:'demo-policy-1',totalCents:8000,dueNowCents:2000,balanceAtVenueCents:6000});
const access=resolveManagementRouteAccess({pathname:'/gestao/clubes/demo/reservas',clubId:'demo',requestedArenaId:'unit-a',club:{capabilities:['reservations'],operationalCapabilities:{reservations:{commercialEnabled:true,available:true}},authority:{permissions:['view_calendar'],allowedArenaIds:['unit-a']}}});
console.log(JSON.stringify({availableCourtIds:available,acceptedPrice:quote,operatorRouteAccess:access,scope:'Pure selected modules only; no database transaction, payment or booking performed.'},null,2));
