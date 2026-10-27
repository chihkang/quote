import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { calendarPublication } from '../src/calendarPublication';
import { bundledCatalog, sha256 } from '../src/calendarCatalog';
import { clearTwEodL1Cache } from '../src/twEod';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearTwEodL1Cache(); });
const key = 'market-calendar/catalog.json';
async function fixture() {
  const baseline = await bundledCatalog();
  const document = JSON.parse(baseline.calendars[baseline.calendars.length-1].document);
  document.calendarVersion = 'fixture-emergency-v3';
  document.TW.holidays.push('2026-10-27');
  document.TW.holidays.sort();
  const raw = JSON.stringify(document);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, '0')).join('');
  const catalog = { ...baseline, revision: 202603, calendars: [...baseline.calendars, {effectiveFrom: '2026-10-27', sha256: hash, document: raw}] };
  const objects = new Map<string, string>();
  let generation = 0;
  let rejectWrite = false;
  const env = { ADMIN_REFRESH_TOKEN: 'admin-fixture', EOD_INGEST_TOKEN: 'ingest-fixture', TW_EOD_R2: {
    get: async (name: string) => objects.has(name) ? {etag: String(generation), json: async () => JSON.parse(objects.get(name)!)} : null,
    put: async (name: string, value: string, options?: R2PutOptions) => {
      if (rejectWrite) return null;
      const condition = options?.onlyIf;
      if (condition instanceof Headers) {
        if (condition.has('if-none-match') && objects.has(name)) return null;
        if (condition.has('if-match') && condition.get('if-match') !== '"' + generation + '"') return null;
      }
      objects.set(name, value); generation++; return {etag: String(generation)};
    }
  } } as unknown as Parameters<typeof worker.fetch>[1];
  const payload = {catalog, expectedRevision: baseline.revision, approvedBy: 'fixture-reviewer', reason: 'Synthetic exchange-wide closure fixture', evidenceURLs: ['https://www.twse.com.tw/staticFiles/news/fixture.pdf']};
  const publish = (body: unknown = payload, token = 'admin-fixture') => worker.fetch(new Request('https://fixture.test/admin/market-calendar/publish', {method: 'POST', headers: {Authorization: 'Bearer ' + token}, body: JSON.stringify(body)}), env);
  return {baseline, catalog, objects, env, payload, publish, rejectWrites: () => {rejectWrite = true;}};
}

it('publishes a persisted catalog once, preserves history and safely retries identical publication', async () => {
  const f = await fixture();
  expect((await f.publish()).status).toBe(200);
  expect((await f.publish()).status).toBe(200);
  const record = JSON.parse(f.objects.get(key)!);
  expect(record.audit).toHaveLength(1);
  expect(record.audit[0]).toMatchObject({revision: 202603, approvedBy: 'fixture-reviewer', evidenceURLs: f.payload.evidenceURLs});
  const response = await worker.fetch(new Request('https://fixture.test/market-calendar'), f.env);
  expect(await response.json()).toEqual(f.catalog);
});

it('uses the same stored version for health and quotes and preserves actual archive dates', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T06:00:00Z'));
  const f = await fixture(); await f.publish();
  for (const [board, source, symbol] of [['twse','TWSE_STOCK_DAY_ALL','2330'],['tpex','TPEX_OPENAPI_MAINBOARD_DAILY_CLOSE_QUOTES','6488']]) {
    f.objects.set(`${board}/eod/2026-10-22.json`, JSON.stringify({tradingDate:'2026-10-22',fetchedAt:'2026-10-22T08:00:00Z',source,quotes:{[symbol]:{close:100}}}));
  }
  const health = await worker.fetch(new Request('https://fixture.test/health/eod'), f.env);
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({complete:true, expectedTradingDate:'2026-10-22',calendarVersion:'fixture-emergency-v3',calendarRevision:202603,marketStatus:'confirmed_closed',archiveStatus:'complete'});
  const quote = await worker.fetch(new Request('https://fixture.test/quotes/close-by-date', {method:'POST',body:JSON.stringify({valuationDate:'2026-10-27',symbols:['2330'],calendarVersion:'fixture-emergency-v3'})}), f.env);
  expect(quote.status).toBe(200);
  expect(await quote.json()).toMatchObject({results:[{price:100,sourceTradingDate:'2026-10-22',calendarVersion:'fixture-emergency-v3',expectedCloseTradingDate:'2026-10-22'}]});
  const fetchSpy = vi.fn(); vi.stubGlobal('fetch',fetchSpy);
  await worker.scheduled({cron:'*/10 * * * *',scheduledTime:Date.now()} as ScheduledController,f.env);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('rejects unauthorized requests before touching storage, including the ingestion-only token', async () => {
  const f = await fixture(); f.env.TW_EOD_R2!.get = vi.fn(() => {throw new Error('must not read');});
  expect((await f.publish(undefined, 'ingest-fixture')).status).toBe(401);
  expect(f.env.TW_EOD_R2!.get).not.toHaveBeenCalled();
});

it.each(['hash','history','revision','date','evidence','approval'] as const)('rejects invalid %s without writes', async issue => {
  const f = await fixture();
  if (issue === 'hash') f.catalog.calendars[f.catalog.calendars.length-1].sha256 = '0'.repeat(64);
  if (issue === 'history') f.catalog.calendars[0].effectiveFrom = '2025-12-02';
  if (issue === 'revision') f.catalog.revision = f.baseline.revision;
  if (issue === 'date') f.catalog.calendars[f.catalog.calendars.length-1].effectiveFrom = '2026-02-30';
  if (issue === 'evidence') f.payload.evidenceURLs = ['https://example.org/unverified'];
  if (issue === 'approval') f.payload.approvedBy = '';
  expect((await f.publish()).status).toBe(400);
  expect(f.objects.size).toBe(0);
});

it('fails closed on unreadable or invalid persisted calendar rather than returning the bundle', async () => {
  const f = await fixture();
  f.objects.set(key, '{}');
  for (const path of ['/market-calendar','/health/eod','/quotes/batch']) {
    const response = await worker.fetch(new Request('https://fixture.test'+path, path.includes('batch') ? {method:'POST',body:'{"market":"TW","symbols":["2330"]}'} : {}),f.env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({error:'Calendar source unavailable',archiveStatus:'calendar_source_error'});
  }
});

it('does not report missing archives as a confirmed complete closure', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T06:00:00Z'));
  const f = await fixture(); await f.publish();
  const response = await worker.fetch(new Request('https://fixture.test/health/eod'),f.env);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({complete:false,marketStatus:'confirmed_closed',archiveStatus:'awaiting_publication'});
});

it('rejects stale expectedRevision and a competing conditional write', async () => {
  const f = await fixture();
  expect((await f.publish({...f.payload,expectedRevision:1})).status).toBe(409);
  f.rejectWrites();
  expect((await f.publish()).status).toBe(409);
  expect(f.objects.size).toBe(0);
});

it('does not activate future releases or accept them before their Taipei effective date', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
  const f = await fixture(); await f.publish();
  const health = await worker.fetch(new Request('https://fixture.test/health/eod'),f.env);
  expect(await health.json()).toMatchObject({calendarVersion:'twse-nyse-2026-v2',expectedTradingDate:'2026-10-22'});
  const response = await worker.fetch(new Request('https://fixture.test/quotes/close-by-date',{method:'POST',body:JSON.stringify({valuationDate:'2026-10-26',symbols:['2330'],calendarVersion:'fixture-emergency-v3'})}),f.env);
  expect(response.status).toBe(422);
});

it('validates ingestion against the stored calendar without relabeling source dates', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T06:00:00Z'));
  const f=await fixture();await f.publish();
  const ingest = (date:string)=>worker.fetch(new Request('https://fixture.test/admin/tpex/eod/ingest',{method:'POST',headers:{Authorization:'Bearer ingest-fixture'},body:JSON.stringify([{Date:date,SecuritiesCompanyCode:'6488',Close:'100'}])}),f.env);
  expect((await ingest('1151027')).status).toBe(409);
  expect((await ingest('1151022')).status).toBe(200);
  expect(f.objects.has('tpex/eod/2026-10-27.json')).toBe(false);
  expect(f.objects.has('tpex/eod/2026-10-22.json')).toBe(true);
});

it('fails closed when calendar storage cannot be read', async () => {
  const f=await fixture();vi.spyOn(f.env.TW_EOD_R2!,'get').mockRejectedValue(new Error('storage unavailable'));
  expect((await worker.fetch(new Request('https://fixture.test/health/eod'),f.env)).status).toBe(503);
});

it('reports dated archive storage failure separately from waiting for publication',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-27T06:00:00Z'));
  const f=await fixture();await f.publish();
  const original=f.env.TW_EOD_R2!.get.bind(f.env.TW_EOD_R2);
  vi.spyOn(f.env.TW_EOD_R2!,'get').mockImplementation(async name=>{
    if(name.includes('/eod/'))throw new Error('archive read failed');
    return original(name);
  });
  const response=await worker.fetch(new Request('https://fixture.test/health/eod'),f.env);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({complete:false,expectedTradingDate:'2026-10-22',calendarVersion:'fixture-emergency-v3',archiveStatus:'source_error'});
});

it('rejects an oversized streamed publication without any storage write', async () => {
  const f=await fixture();
  expect((await f.publish({...f.payload,reason:'x'.repeat(1024*1024)})).status).toBe(400);
  expect(f.objects.size).toBe(0);
});

it('requires initialized storage in production and permits an explicitly approved bundled bootstrap', async()=>{
  const f=await fixture();
  const env={...f.env,CALENDAR_STORAGE_REQUIRED:'true'};
  expect((await worker.fetch(new Request('https://fixture.test/market-calendar'),env)).status).toBe(503);
  const publish=await worker.fetch(new Request('https://fixture.test/admin/market-calendar/publish',{method:'POST',headers:{Authorization:'Bearer admin-fixture'},body:JSON.stringify({...f.payload,catalog:f.baseline})}),env);
  expect(publish.status).toBe(200);
  expect(await (await worker.fetch(new Request('https://fixture.test/market-calendar'),env)).json()).toEqual(f.baseline);
  f.objects.delete(key);
  expect((await worker.fetch(new Request('https://fixture.test/health/eod'),env)).status).toBe(503);
  expect((await worker.fetch(new Request('https://fixture.test/admin/market-calendar/publish',{method:'POST',headers:{Authorization:'Bearer admin-fixture'},body:JSON.stringify({...f.payload,catalog:f.baseline})}),env)).status).toBe(503);
});

it('never falls back to v1 when the current published release does not cover the request date',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T06:00:00Z'));
  const f=await fixture();
  const entry=f.catalog.calendars[f.catalog.calendars.length-1];
  const data=JSON.parse(entry.document);data.coverageEnd='2026-10-27';
  data.TW.holidays=data.TW.holidays.filter((day:string)=>day<='2026-10-27');
  data.US.holidays=data.US.holidays.filter((day:string)=>day<='2026-10-27');
  data.US.earlyCloses={};
  entry.document=JSON.stringify(data);entry.sha256=await sha256(entry.document);await f.publish();
  const health=await worker.fetch(new Request('https://fixture.test/health/eod'),f.env);
  expect(await health.json()).toMatchObject({complete:false,expectedTradingDate:null,calendarVersion:null,archiveStatus:'calendar_unavailable'});
  const batch=await worker.fetch(new Request('https://fixture.test/quotes/batch',{method:'POST',body:'{"market":"TW","symbols":["2330"]}'}),f.env);
  expect(batch.status).toBe(422);
  const fetchSpy=vi.fn();vi.stubGlobal('fetch',fetchSpy);
  await worker.scheduled({cron:'*/10 * * * *',scheduledTime:Date.now()} as ScheduledController,f.env);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it.each(['unsorted','weekend','lateClose','missingSources','longVersion','longDocument'] as const)('rejects %s rules that the App cannot accept',async issue=>{
  const f=await fixture();
  const entry=f.catalog.calendars[f.catalog.calendars.length-1];
  const data=JSON.parse(entry.document);
  if(issue==='unsorted')data.TW.holidays.reverse();
  if(issue==='weekend')data.TW.holidays.push('2026-10-24');
  if(issue==='lateClose')data.US.earlyCloses['2026-10-28']='17:00';
  if(issue==='missingSources')delete data.sources;
  if(issue==='longVersion')data.calendarVersion='v'.repeat(97);
  if(issue==='longDocument')data.note='x'.repeat(131072);
  entry.document=JSON.stringify(data);entry.sha256=await sha256(entry.document);
  expect((await f.publish()).status).toBe(400);
  expect(f.objects.size).toBe(0);
});
