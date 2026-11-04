import test from 'node:test';
import assert from 'node:assert/strict';
import { getAvailableScheduleCourtIds, buildScheduleVacancySlots } from '../src/management-schedule-availability.ts';
import { localDateTimeInTimeZoneToIso } from '../src/management-local-time.ts';
import { assertOccupancyNotPast, isFutureScheduleSlot } from '../src/management-reservation-time.ts';
import { resolveManagementRouteAccess } from '../src/management-access-policy.ts';
import { getManagementArenaHref } from '../src/management-arena-navigation.ts';
import { parseReservationPricePreview } from '../src/management-reservation-quote.ts';

const date='2026-11-04';
const courts=[{id:'court-a',status:'active'},{id:'court-b',status:'active'},{id:'closed',status:'inactive'}];
const event={courtId:'court-a',localDate:date,startMinute:600,endMinute:660};
const available=(startMinute:number,durationMinutes=60)=>getAvailableScheduleCourtIds({courts,events:[event],localDate:date,startMinute,durationMinutes});

test('a second selection excludes the occupied court without closing another court',()=>assert.deepEqual(available(600),['court-b']));
test('touching time boundaries allow consecutive bookings',()=>{assert.deepEqual(available(540),['court-a','court-b']);assert.deepEqual(available(660),['court-a','court-b']);});
test('partial overlaps and longer activities occupy the requested interval',()=>{assert.deepEqual(available(570,60),['court-b']);assert.deepEqual(available(540,180),['court-b']);});
test('an event from another day does not consume today’s capacity',()=>assert.deepEqual(getAvailableScheduleCourtIds({courts,events:[{...event,localDate:'2026-11-05'}],localDate:date,startMinute:600}),['court-a','court-b']));
test('a fully occupied interval disappears from vacancy suggestions',()=>{const slots=buildScheduleVacancySlots({courts,events:[event,{...event,courtId:'court-b'}],localDate:date});assert(!slots.some(s=>s.startMinute===600));assert(slots.some(s=>s.startMinute===660));});
test('a club local time resolves to its real UTC instant',()=>assert.equal(localDateTimeInTimeZoneToIso('2026-11-04T10:30','America/Sao_Paulo'),'2026-11-04T13:30:00.000Z'));
test('invalid calendar dates and unknown zones are rejected',()=>{for(const [value,zone] of [['2026-02-30T10:30','UTC'],['2026-11-04T25:00','UTC'],['2026-11-04T10:30','Unknown/Zone']])assert.throws(()=>localDateTimeInTimeZoneToIso(value,zone),/MANAGEMENT_LOCAL_TIME_INVALID/);});
test('the exact current minute is past and finished occupancy remains read-only',()=>{const now=Date.parse('2026-11-04T13:30:00Z');assert.equal(isFutureScheduleSlot({localDate:date,startMinute:630},'America/Sao_Paulo',now),false);assert.throws(()=>assertOccupancyNotPast('2026-11-04T13:30:00Z',now),/SCHEDULE_HISTORY_READ_ONLY/);});

const club={capabilities:['reservations','billing'],operationalCapabilities:{reservations:{commercialEnabled:true,available:true},billing:{commercialEnabled:true,available:true}},authority:{permissions:['view_calendar','record_check_in'],allowedArenaIds:['unit-a']}};
const access=(section:string,patch={},requestedArenaId='unit-a')=>resolveManagementRouteAccess({pathname:'/gestao/clubes/club-a/'+section,clubId:'club-a',club:{...club,...patch},requestedArenaId});
test('the operator can read a released schedule inside the assigned unit',()=>assert.equal(access('reservas').allowed,true));
test('a finance page requires its own permission',()=>assert.deepEqual(access('financeiro'),{allowed:false,section:'Financeiro',reason:'permission_denied',permission:'view_finance'}));
test('changing to a unit outside the assignment denies route access',()=>assert.deepEqual(access('reservas',{},'unit-b'),{allowed:false,section:'Reservas',reason:'arena_scope_denied'}));
test('commercial capability and operational release remain distinct',()=>{assert.equal(access('reservas',{capabilities:[]}).allowed,false);assert.deepEqual(access('reservas',{operationalCapabilities:{reservations:{commercialEnabled:true,available:false,reasonCode:'release-pending'}}}),{allowed:false,section:'Reservas',reason:'capability_not_released',capability:'reservations',detailCode:'release-pending'});});
test('unknown routes and a different club URL are not granted',()=>{assert.equal(access('unknown').allowed,false);assert.equal(resolveManagementRouteAccess({pathname:'/gestao/clubes/club-b/reservas',clubId:'club-a',club}).allowed,false);});
test('reception permits check-in without granting the finance workspace',()=>{assert.equal(access('recepcao').allowed,true);assert.equal(access('financeiro').allowed,false);});
test('unit navigation keeps unrelated filters and the fragment',()=>assert.equal(getManagementArenaHref({pathname:'/gestao/clubes/club-a/reservas',search:'?date=2026-11-04&arenaId=old',hash:'#agenda'},'unit-a'),'/gestao/clubes/club-a/reservas?date=2026-11-04&arenaId=unit-a#agenda'));
test('a late price from a previous court is rejected after the selection changes',()=>{const intent={courtId:'court-a',responsibleAssociationId:'client-a',startsAt:'2026-11-04T13:00:00Z',endsAt:'2026-11-04T14:00:00Z'};const preview={...intent,courtId:'court-b',policyVersion:'policy-a',totalCents:8000,dueNowCents:2000,balanceAtVenueCents:6000,currency:'BRL',evaluatedAt:'2026-11-04T12:00:00Z',requiresRevalidation:true};assert.throws(()=>parseReservationPricePreview(preview,intent),/RESERVATION_PREVIEW_INVALID/);});
