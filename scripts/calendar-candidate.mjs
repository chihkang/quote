import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

function officialURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !['www.twse.com.tw','www.tpex.org.tw','www.nyse.com'].includes(url.hostname)) throw new Error('An exact official HTTPS source is required');
  return url;
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z'))
    && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
}
export function classifyAnnualRows(payload) {
  if (payload?.stat !== 'ok' || !Array.isArray(payload.data) || JSON.stringify(payload.fields) !== JSON.stringify(['日期','名稱','說明'])) throw new Error('Annual API schema unavailable');
  const result = {closed:[],open:[],needsReview:[]};
  for (const row of payload.data) {
    if (!Array.isArray(row) || row.length !== 3 || !row.every(item => typeof item === 'string') || !validDate(row[0])) throw new Error('Invalid annual row');
    const [date,title,description] = row;
    const text = title+' '+description;
    const kind = /開始交易|最後交易/.test(text) ? 'open' : /市場無交易|放假|補假|休市/.test(text) ? 'closed' : 'needsReview';
    result[kind].push({date,title,description});
  }
  return result;
}
export async function createNoticeCandidate({url,text,retrievedAt}) {
  officialURL(url);
  if (typeof text !== 'string' || !text.trim() || text.length > 100000 || /<html|<!doctype|access denied/i.test(text)
    || !Number.isFinite(Date.parse(retrievedAt))) throw new Error('Notice text unavailable');
  // Conservative hint only. Human review must establish the exchange, scope and date.
  const match = /(?:集中交易市場|證券市場)[\s\S]{0,60}?(\d{3,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[\s\S]{0,40}?(?:全日休市|休市一天)/.exec(text);
  let closureDate = null;
  if (match && !/個股|公司股票|停止交易|暫停交易/.test(text)) {
    const year = Number(match[1]) < 1911 ? Number(match[1])+1911 : Number(match[1]);
    const value = `${year}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
    if (validDate(value)) closureDate = value;
  }
  return {status:'needs_human_approval',autoPublish:false,scope:closureDate ? 'exchange' : 'unverified',market:'TW',closureDate,
    sourceURL:url,retrievedAt,sha256:createHash('sha256').update(text).digest('hex'),hashContent:'provided UTF-8 notice text',text,
    limitation:'Discovery feed is not verified. Scope/date are review hints only. Provided text must be checked against the saved official source.'};
}

async function run() {
  const {values} = parseArgs({options:{url:{type:'string'},output:{type:'string'},'text-file':{type:'string'}}});
  const url = officialURL(values.url);
  if (!values.output) throw new Error('--output required');
  const response = await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error('Official source HTTP '+response.status);
  const reader = response.body.getReader();
  const chunks=[];let size=0;
  for (;;) {
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>8*1024*1024){await reader.cancel();throw new Error('Official source too large');}
    chunks.push(value);
  }
  const bytes=Buffer.concat(chunks);
  if (!bytes.length || bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('Expected an official PDF; source remains unverified');
  await mkdir(values.output,{recursive:true});
  const retrievedAt=new Date().toISOString();
  const candidate=values['text-file'] ? await createNoticeCandidate({url:url.href,text:await readFile(values['text-file'],'utf8'),retrievedAt})
    : {status:'needs_human_approval',autoPublish:false,scope:'unverified',closureDate:null,sourceURL:url.href,retrievedAt,
      limitation:'PDF saved for manual reading; no verified announcement feed or text extractor configured.'};
  candidate.sourceSha256=createHash('sha256').update(bytes).digest('hex');
  await writeFile(values.output+'/official-source.pdf',bytes,{flag:'wx'});
  await writeFile(values.output+'/candidate.json',JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:candidate.status,scope:candidate.scope,closureDate:candidate.closureDate,autoPublish:false}));
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch(error=>{console.error(error.message);process.exitCode=1;});
