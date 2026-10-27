import {createHash} from 'node:crypto';
import {appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const validDate=day=>typeof day==='string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day+'T12:00:00Z')) && new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
const previous=day=>new Date(Date.parse(day+'T12:00:00Z')-86400000).toISOString().slice(0,10);
function selectedEntry(catalog,day) {
  if(catalog?.schemaVersion!==1 || !Number.isSafeInteger(catalog.revision) || !Array.isArray(catalog.calendars) || !catalog.calendars.length || catalog.calendars.length>100)throw new Error('Invalid calendar catalog');
  for(const entry of catalog.calendars) {
    if(typeof entry.document!=='string' || createHash('sha256').update(entry.document).digest('hex')!==entry.sha256)throw new Error('Invalid calendar digest');
  }
  const entry=catalog.calendars.map((entry,index)=>({...entry,index})).filter(entry=>entry.effectiveFrom<=day)
    .sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom)||b.index-a.index)[0];
  if(!entry)throw new Error('Date outside calendar coverage');
  const data=JSON.parse(entry.document);
  if(day<data.coverageStart || day>data.coverageEnd)throw new Error('Date outside calendar coverage');
  return data;
}
export function previewClosure(catalog,market,day,action) {
  if(!['TW','US'].includes(market) || !validDate(day) || !['close','reopen'].includes(action))throw new Error('Choose TW/US, YYYY-MM-DD and close/reopen');
  const data=selectedEntry(catalog,day),rules=data[market];
  if(!Array.isArray(rules?.holidays))throw new Error('Invalid market rules');
  const last=data.corrections?.filter(item=>item.market===market && item.date===day).at(-1);
  if(action==='reopen' && !(last?.kind==='manual_override' && last.action!=='reopen'))throw new Error('Only manually added closures can be revoked');
  const holidays=new Set(rules.holidays);
  if(action==='close')holidays.add(day);else holidays.delete(day);
  let candidate=day;
  for(let attempts=0;attempts<400 && candidate>=data.coverageStart;attempts++,candidate=previous(candidate)) {
    const weekday=new Date(candidate+'T12:00:00Z').getUTCDay();
    if(weekday!==0 && weekday!==6 && !holidays.has(candidate))return {market,date:day,action,revision:catalog.revision,expectedTradingDate:candidate};
  }
  throw new Error('No covered completed trading date');
}
async function readJSON(response,limit=1048576) {
  const reader=response.body?.getReader();if(!reader)throw new Error('Missing response');
  const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Response too large');}chunks.push(value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function githubIDToken(audience,fetchImpl=fetch) {
  const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if(url.protocol!=='https:' || !url.hostname.endsWith('.actions.githubusercontent.com') || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw new Error('GitHub OIDC is unavailable');
  url.searchParams.set('audience',audience);
  const response=await fetchImpl(url,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('GitHub OIDC request failed: HTTP '+response.status);
  const body=await readJSON(response,32768);
  if(typeof body.value!=='string' || body.value.length>16384)throw new Error('Invalid OIDC response');
  return body.value;
}
export async function manageCalendar({workerURL,market,date,action,reason,publish=false,expectedRevision,fetchImpl=fetch,getToken=githubIDToken}) {
  const base=new URL(workerURL);
  if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash || !['','/'].includes(base.pathname))throw new Error('Configure the exact HTTPS Worker origin');
  if(typeof reason!=='string' || !reason.trim() || reason.length>500)throw new Error('A concise reason is required');
  if(!['TW','US'].includes(market) || !validDate(date) || !['close','reopen'].includes(action))throw new Error('Invalid market/date/action');
  const catalogURL=new URL('/market-calendar',base);
  const getCatalog=async()=>{
    let response=await fetchImpl(catalogURL,{redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(response.status===503)response=await fetchImpl(new URL('/market-calendar/bootstrap',base),{redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(!response.ok)throw new Error('Calendar read failed: HTTP '+response.status);
    return readJSON(response);
  };
  const catalog=await getCatalog();
  const preview=previewClosure(catalog,market,date,action);
  if(!publish)return {...preview,published:false,initializing:catalog.bootstrap===true};
  if(expectedRevision!==catalog.revision)throw new Error('Calendar revision changed; preview again before publishing');
  const endpoint=new URL('/admin/market-calendar/closures',base);
  const token=await getToken(endpoint.href);
  let response;
  try {
    response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({market,date,action,reason,expectedRevision,approvedBy:'GitHub Actions'})});
  }catch{throw new Error('Publication outcome uncertain; read the catalog before retrying');}
  if(!response.ok)throw new Error('Calendar publication HTTP '+response.status+'; reload the catalog before retrying');
  const result=await readJSON(response,32768);
  const verified=await getCatalog();
  const after=selectedEntry(verified,date);
  const closed=[0,6].includes(new Date(date+'T12:00:00Z').getUTCDay()) || after[market].holidays.includes(date);
  if(!Number.isSafeInteger(result.revision) || verified.revision<result.revision || closed!==(action==='close'))throw new Error('Publication read-back did not confirm the requested date; do not blindly retry');
  let archive={complete:false,status:'not_verified'};
  try {
    const health=await fetchImpl(new URL('/health/eod',base),{redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
    const body=await readJSON(health,32768);
    archive={complete:health.ok && body.complete===true,expectedTradingDate:body.expectedTradingDate,calendarVersion:body.calendarVersion,
      status:body.archiveStatus ?? (body.complete ? 'complete' : 'awaiting_publication')};
  }catch{/* A calendar write never establishes that official archive prices exist. */}
  return {...preview,revision:verified.revision,published:true,archive};
}
async function main() {
  const result=await manageCalendar({workerURL:process.env.QUOTE_WORKER_URL,market:process.env.CALENDAR_MARKET,date:process.env.CALENDAR_DATE,
    action:process.env.CALENDAR_ACTION,reason:process.env.CALENDAR_REASON,publish:process.argv.includes('--publish'),
    expectedRevision:Number(process.env.CALENDAR_EXPECTED_REVISION)});
  console.log(JSON.stringify(result));
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'revision='+result.revision+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## ${result.published?'日曆已發布':'日曆預覽，尚未發布'}\n\n${result.market} · ${result.date} · ${result.action}\n\n預期收盤來源日：${result.expectedTradingDate}。日曆 revision：${result.revision}。\n\n`+
    (result.published?`歸檔驗證獨立計算：${result.archive.status}，complete=${result.archive.complete}。缺資料不代表休市，也不代表結算完成。\n`:'確認日期、市場與操作後，重新執行並勾選發布。\n'));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
