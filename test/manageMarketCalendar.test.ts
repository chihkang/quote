import {expect,it,vi} from 'vitest';
import {bundledCatalog} from '../src/calendarCatalog';
import {previewClosure,manageCalendar} from '../scripts/manage-market-calendar.mjs';

it('previews a date-scoped Taiwan closure without touching US rules',async()=>{
  const catalog=await bundledCatalog();
  expect(previewClosure(catalog,'TW','2026-10-27','close')).toMatchObject({market:'TW',date:'2026-10-27',expectedTradingDate:'2026-10-22',revision:202602});
  expect(previewClosure(catalog,'US','2026-10-27','close')).toMatchObject({expectedTradingDate:'2026-10-26'});
  expect(()=>previewClosure(catalog,'TW','2026-02-30','close')).toThrow();
  expect(()=>previewClosure(catalog,'TW','2026-10-23','reopen')).toThrow();
});
it('never requests a write token or publishes in preview mode',async()=>{
  const catalog=await bundledCatalog();
  const fetchImpl=vi.fn(async()=>Response.json(catalog));
  const token=vi.fn();
  const result=await manageCalendar({workerURL:'https://quote.test',market:'TW',date:'2026-10-27',action:'close',reason:'manual',publish:false,fetchImpl,getToken:token});
  expect(result).toMatchObject({published:false,expectedTradingDate:'2026-10-22'});
  expect(fetchImpl).toHaveBeenCalledTimes(1);expect(token).not.toHaveBeenCalled();
});
it('rejects a changed preview revision without issuing a write',async()=>{
  const catalog=await bundledCatalog();const token=vi.fn();
  await expect(manageCalendar({workerURL:'https://quote.test',market:'TW',date:'2026-10-27',action:'close',reason:'manual',publish:true,expectedRevision:1,fetchImpl:async()=>Response.json(catalog),getToken:token})).rejects.toThrow('revision');
  expect(token).not.toHaveBeenCalled();
});
it('does not retry a write whose outcome is uncertain',async()=>{
  const catalog=await bundledCatalog();let writes=0;
  const fetchImpl=async(_url:RequestInfo|URL,options?:RequestInit)=>{
    if(options?.method==='POST'){writes++;throw new Error('connection lost');}
    return Response.json(catalog);
  };
  await expect(manageCalendar({workerURL:'https://quote.test',market:'TW',date:'2026-10-27',action:'close',reason:'manual',publish:true,expectedRevision:202602,fetchImpl,getToken:async()=> 'fixture-jwt'})).rejects.toThrow('uncertain');
  expect(writes).toBe(1);
});

it('confirms an already closed weekend without requiring a weekday holiday entry',async()=>{
  const catalog=await bundledCatalog();
  const fetchImpl=async(_url:RequestInfo|URL,options?:RequestInit)=>Response.json(options?.method==='POST'?{revision:catalog.revision,alreadyClosed:true}:catalog);
  expect(await manageCalendar({workerURL:'https://quote.test',market:'TW',date:'2026-10-31',action:'close',reason:'weekend',publish:true,
    expectedRevision:catalog.revision,fetchImpl,getToken:async()=> 'fixture-jwt'})).toMatchObject({published:true,revision:202602,expectedTradingDate:'2026-10-30'});
});
