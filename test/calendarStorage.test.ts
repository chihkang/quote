import { expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { bundledCatalog, loadCalendarCatalog, publishCalendar, sha256 } from '../src/calendarCatalog';

it('uses real R2 conditional writes to preserve one approval across competing publishers and retries',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("fixture")}}',r2Buckets:['CALENDAR']}));
  try {
    const bucket=await mf.getR2Bucket('CALENDAR');
    // Miniflare's Node adapter and Worker types describe different stream implementations.
    const env={TW_EOD_R2:bucket as unknown as R2Bucket,ADMIN_REFRESH_TOKEN:'fixture'};
    const baseline=await bundledCatalog();
    const data=JSON.parse(baseline.calendars[1].document);
    data.calendarVersion='fixture-storage-v3';data.TW.holidays.push('2026-10-27');data.TW.holidays.sort();
    const document=JSON.stringify(data);
    const catalog={...baseline,revision:202603,calendars:[...baseline.calendars,{effectiveFrom:'2026-10-27',document,sha256:await sha256(document)}]};
    const request=()=>new Request('https://fixture.test/admin/market-calendar/publish',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({catalog,expectedRevision:202602,approvedBy:'fixture',reason:'Synthetic CAS test',evidenceURLs:['https://www.twse.com.tw/staticFiles/news/fixture.pdf']})});
    const responses=await Promise.all([publishCalendar(request(),env),publishCalendar(request(),env)]);
    expect(responses.some(response=>response.status===200)).toBe(true);
    expect(responses.every(response=>[200,409].includes(response.status))).toBe(true);
    const saved=await loadCalendarCatalog(env);
    expect(saved.catalog).toEqual(catalog);expect(saved.audit).toHaveLength(1);
    expect((await publishCalendar(request(),env)).status).toBe(200);
    expect((await loadCalendarCatalog(env)).audit).toHaveLength(1);
  } finally {await mf.dispose();}
});
