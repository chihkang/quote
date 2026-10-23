import { getTtlSeconds } from '../src/ttl';
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';
import { calendarRevision, releasedCalendars, marketCalendar, resolveMarketCloseContext, selectMarketCalendar, type CalendarRelease } from '../src/marketCalendar';

const next = { ...marketCalendar, calendarVersion: 'fixture-2027', coverageStart: '2026-12-01', coverageEnd: '2027-12-31',
  TW: { holidays: ['2027-01-01'], earlyCloses: {} }, US: { holidays: ['2027-01-01'], earlyCloses: {'2027-11-26': '13:00'} } };
const releases: CalendarRelease[] = [ { effectiveFrom: '2025-12-01', data: marketCalendar }, { effectiveFrom: '2027-01-01', data: next } ];
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network disabled in calendar tests'); }));
afterEach(() => vi.useRealTimers());
describe('downloadable calendar contract', () => {
  it('publishes the same immutable calendar used by quotes with a matching digest', async () => {
    const response = await worker.fetch(new Request('https://quote.test/market-calendar'), {} as never);
    expect(response.status).toBe(200);
    const body = await response.json() as {schemaVersion:number; revision:number; calendars:{sha256:string;document:string;effectiveFrom:string}[]};
    expect(body.schemaVersion).toBe(1);
    expect(body.revision).toBeGreaterThan(0);
    expect(JSON.parse(body.calendars[0].document)).toEqual(marketCalendar);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.calendars[0].document));
    expect(body.calendars[0].sha256).toBe(Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join(''));
  });
  it('does not activate next year early', () => {
    expect(selectMarketCalendar(new Date('2026-12-30T06:00:00Z'), undefined, releases)?.calendarVersion).toBe(marketCalendar.calendarVersion);
  });
  it('activates on Taipei midnight while retaining previous New York coverage', () => {
    expect(selectMarketCalendar(new Date('2026-12-31T16:00:00Z'), undefined, releases)?.calendarVersion).toBe('fixture-2027');
    expect(selectMarketCalendar(new Date('2026-12-31T16:00:00Z'), marketCalendar.calendarVersion, releases)).toBeUndefined();
  });
  it('retains an old version for historical requests', () => {
    expect(selectMarketCalendar(new Date('2026-09-29T06:00:00Z'), marketCalendar.calendarVersion, releases)).toEqual(marketCalendar);
  });
  it('uses the newest append when a future annual calendar is corrected before activation', () => {
    const correction = {...next,calendarVersion:'fixture-2027-v2',US:{...next.US,earlyCloses:{'2027-11-26':'12:00'}}};
    const amended = [...releases,{effectiveFrom:'2027-01-01',data:correction}];
    expect(selectMarketCalendar(new Date('2027-01-04T06:00:00Z'),undefined,amended)?.calendarVersion).toBe('fixture-2027-v2');
    expect(selectMarketCalendar(new Date('2027-01-04T06:00:00Z'),'fixture-2027',amended)?.calendarVersion).toBe('fixture-2027');
  });
  it('rejects unknown version before quote providers or archives', async () => {
    for (const path of ['/quotes/batch','/quotes/close-by-date']) {
      const response = await worker.fetch(new Request('https://quote.test'+path, {method:'POST',body:JSON.stringify({market:'TW',symbols:['2330'],valuationDate:'2026-09-29',calendarVersion:'missing'})}), {} as never);
      expect(response.status).toBe(422);
    }
  });
  it('rejects malformed version instead of ignoring it', async () => {
    const response = await worker.fetch(new Request('https://quote.test/quotes/batch', {method:'POST',body:JSON.stringify({symbols:['2330'],calendarVersion:42})}), {} as never);
    expect(response.status).toBe(400);
  });
});

describe('pinned market-session timing', () => {
  it('honors a revised Taiwan early close in session context', () => {
    const amended = {...marketCalendar, TW:{...marketCalendar.TW,earlyCloses:{'2026-09-29':'12:00'}}};
    expect(resolveMarketCloseContext('TW',new Date('2026-09-29T04:01:00Z'),amended).marketSessionState).toBe('post_close');
    expect(getTtlSeconds('TW',new Date('2026-09-29T04:01:00Z'),{SOFT_TTL_TRADING_SEC:'300',SOFT_TTL_OFFHOURS_SEC:'1000'},amended).soft).toBe(1000);
  });
});


describe('append-only October closure publication', () => {
  it('retains the published v1 digest and appends a separately hashed v2', async () => {
    const response = await worker.fetch(new Request('https://quote.test/market-calendar'), {} as never);
    const body = await response.json() as {revision: number; calendars: {effectiveFrom: string; sha256: string; document: string}[]};
    expect(body.revision).toBe(202602);
    expect(body.revision).toBe(calendarRevision);
    expect(body.calendars).toHaveLength(2);
    expect(body.calendars[0].effectiveFrom).toBe('2025-12-01');
    // Frozen digest of the original published JSON document, not recomputed from a mutable fixture.
    expect(body.calendars[0].sha256).toBe('3c406eaf4f5eed72886e83add2e72a5a1ac23f5501dedf18485eb1f90f56aaab');
    const correction = body.calendars[1];
    expect(correction.effectiveFrom).toBe('2026-10-23');
    expect(JSON.parse(correction.document)).toEqual(releasedCalendars[1].data);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(correction.document));
    expect(correction.sha256).toBe(Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''));
    const v2 = JSON.parse(correction.document);
    expect(v2.calendarVersion).toBe('twse-nyse-2026-v2');
    expect(v2.TW.holidays).toEqual([...marketCalendar.TW.holidays, '2026-10-23'].sort());
    expect(v2.TW.earlyCloses).toEqual(marketCalendar.TW.earlyCloses);
    expect(v2.US).toEqual(marketCalendar.US);
    expect([v2.coverageStart, v2.coverageEnd]).toEqual([marketCalendar.coverageStart, marketCalendar.coverageEnd]);
  });
  it('activates only at Taipei midnight and preserves explicit historical versions', () => {
    const before = new Date('2026-10-22T15:59:59Z');
    const after = new Date('2026-10-22T16:00:00Z');
    expect(selectMarketCalendar(before)).toBe(marketCalendar);
    expect(selectMarketCalendar(before, 'twse-nyse-2026-v2')).toBeUndefined();
    expect(selectMarketCalendar(after)?.calendarVersion).toBe('twse-nyse-2026-v2');
    expect(selectMarketCalendar(after, marketCalendar.calendarVersion)).toBe(marketCalendar);
    const historical = new Date('2026-10-22T06:00:00Z');
    expect(resolveMarketCloseContext('TW', historical)).toEqual({
      expectedCloseTradingDate: '2026-10-22', marketSessionState: 'post_close',
      calendarVersion: 'twse-nyse-2026-v1'
    });
    expect(resolveMarketCloseContext('TW', new Date('2026-10-23T06:00:00Z'), marketCalendar))
      .toMatchObject({expectedCloseTradingDate: '2026-10-23', calendarVersion: 'twse-nyse-2026-v1'});
  });
});
