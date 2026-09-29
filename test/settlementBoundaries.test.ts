import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { l1Clear } from '../src/l1Cache';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); l1Clear(); });
function env(overrides: Record<string,string> = {}) {
  return { QUOTES_KV: {get: async () => null, put: async () => undefined},
    FINNHUB_API_KEY:'fixture', FUGLE_API_KEY:'fixture', ...overrides } as unknown as Parameters<typeof worker.fetch>[1];
}
function request(market: string) { return new Request('https://fixture.invalid/quotes/batch', {
  method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify({symbols:[market==='US'?'DEMO':'2330'],market}) }); }
it('does not invent a US source timestamp from fetch time', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T20:04:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({c:100}),{status:200})));
  const response=await worker.fetch(request('US'),env()); const json=await response.json() as any;
  expect(json.results[0].asOf).toBeNull();
});
it('keeps custom Taiwan close context consistent with trading window', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T05:35:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({price:100,lastUpdated:'2026-09-29T05:35:00Z'}),{status:200})));
  const response=await worker.fetch(request('TW'),env({TW_CLOSE:'14:00'})); const json=await response.json() as any;
  expect(json.results[0].marketSessionState).toBe('open');
  expect(json.results[0].expectedCloseTradingDate).toBe('2026-09-24');
});

it('rejects malformed Taiwan session configuration', async () => {
  expect((await worker.fetch(request('TW'), env({TW_CLOSE:'99:00'}))).status).toBe(400);
});
it('refreshes legacy US caches once to establish raw source time', async () => {
  vi.useFakeTimers(); const now=new Date('2026-09-28T05:35:00Z'); vi.setSystemTime(now);
  const cached={symbol:'DEMO',canonicalSymbol:'DEMO.US',market:'US',price:100,currency:'USD',
    asOf:'2026-09-25T20:00:00Z',fetchedAt:now.toISOString(),ttlHardSec:3600,expiresAt:new Date(+now+3600000).toISOString()};
  const provider=vi.fn(async () => new Response(JSON.stringify({c:100,t:Date.parse(cached.asOf)/1000}),{status:200}));
  vi.stubGlobal('fetch',provider);
  const config=env(); let store=JSON.stringify(cached);
  config.QUOTES_KV={get:async()=>store,put:async(_key:string,value:string)=>{store=value;}} as unknown as KVNamespace;
  const json=await (await worker.fetch(request('US'),config)).json() as any;
  expect(provider).toHaveBeenCalledTimes(1);
  expect(json.results[0].sourceTimestampVerified).toBe(true);
  l1Clear(); await worker.fetch(request('US'),config);
  expect(provider).toHaveBeenCalledTimes(1);
});
