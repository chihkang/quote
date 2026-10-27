import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { authorizeCalendarAction } from '../src/calendarActionAuthorization';
import worker from '../src/index';
import {manageCalendar} from '../scripts/manage-market-calendar.mjs';

const audience='https://quote.test/admin/market-calendar/closures';
let privateKey:CryptoKey;
let jwk:JsonWebKey;
const encode=(value:unknown)=>btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
beforeAll(async()=>{
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  privateKey=keys.privateKey;jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
async function token(overrides:Record<string,unknown>={}) {
  const now=Math.floor(Date.now()/1000);
  const claims={iss:'https://token.actions.githubusercontent.com',aud:audience,sub:'repo:chihkang/quote:ref:refs/heads/main',
    repository:'chihkang/quote',repository_id:'1142362573',repository_owner_id:'8790142',actor_id:'8790142',actor:'chihkang',
    ref:'refs/heads/main',workflow_ref:'chihkang/quote/.github/workflows/manage-market-calendar.yml@refs/heads/main',event_name:'workflow_dispatch',
    iat:now,nbf:now,exp:now+300,run_id:'12345',run_attempt:'1',...overrides};
  const input=encode({alg:'RS256',kid:'fixture'})+'.'+encode(claims);
  const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,new TextEncoder().encode(input)));
  return input+'.'+btoa(String.fromCharCode(...signature)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
async function authorize(overrides:Record<string,unknown>={},configured=true) {
  const fetchImpl=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
    expect(String(input)).toBe('https://token.actions.githubusercontent.com/.well-known/jwks');
    expect(options?.headers).toBeUndefined();
    return Response.json({keys:[{...jwk,kid:'fixture',alg:'RS256',use:'sig'}]});
  });vi.stubGlobal('fetch',fetchImpl);
  const result=await authorizeCalendarAction(new Request(audience,{method:'POST',headers:{Authorization:'Bearer '+await token(overrides)}}),
    {CALENDAR_GITHUB_AUDIENCE:configured?audience:undefined});
  return {result,fetchImpl};
}
it('accepts only the signed owner-triggered main workflow without storing a credential',async()=>{
  expect((await authorize()).result).toEqual({actor:'chihkang',runId:'12345',runAttempt:'1'});
});
it.each([
  {repository_id:'999'}, {repository:'other/quote'}, {actor_id:'999'}, {ref:'refs/heads/feature'},
  {workflow_ref:'chihkang/quote/.github/workflows/other.yml@refs/heads/main'}, {event_name:'pull_request'},
  {aud:'https://other.test'}, {iss:'https://other.test'}, {exp:1}, {iat:1}, {nbf:9999999999}
])('rejects invalid claims %j before downloading signing keys',async claims=>{
  const {result,fetchImpl}=await authorize(claims);expect(result).toBeNull();expect(fetchImpl).not.toHaveBeenCalled();
});
it('remains disabled until the Worker trust is explicitly configured',async()=>{
  const {result,fetchImpl}=await authorize({},false);expect(result).toBeNull();expect(fetchImpl).not.toHaveBeenCalled();
});
it('fails closed on a signature mismatch or unavailable signing-key source',async()=>{
  const signed=await token();
  vi.stubGlobal('fetch',async()=>Response.json({keys:[{...jwk,n:'AQAB',kid:'fixture',alg:'RS256',use:'sig'}]}));
  const request=()=>new Request(audience,{method:'POST',headers:{Authorization:'Bearer '+signed}});
  expect(await authorizeCalendarAction(request(),{CALENDAR_GITHUB_AUDIENCE:audience})).toBeNull();
  vi.stubGlobal('fetch',async()=>{throw new Error('offline');});
  expect(await authorizeCalendarAction(request(),{CALENDAR_GITHUB_AUDIENCE:audience})).toBeNull();
});

it('publishes and revokes through the real workflow client and Worker while missing archives stay incomplete',async()=>{
  const objects=new Map<string,string>();
  let generation=0;
  const env={ADMIN_REFRESH_TOKEN:'admin-fixture',EOD_INGEST_TOKEN:'ingest-fixture',CALENDAR_STORAGE_REQUIRED:'true',CALENDAR_GITHUB_AUDIENCE:audience,
    TW_EOD_R2:{get:async(key:string)=>objects.has(key)?{etag:String(generation),json:async()=>JSON.parse(objects.get(key)!)}:null,
      put:async(key:string,value:string)=>{objects.set(key,value);generation++;return {etag:String(generation)};}}
  } as unknown as Parameters<typeof worker.fetch>[1];
  vi.stubGlobal('fetch',async()=>Response.json({keys:[{...jwk,kid:'fixture',alg:'RS256',use:'sig'}]}));
  const fetchImpl:typeof fetch=async(input,options)=>worker.fetch(new Request(input,options),env);
  const first=await manageCalendar({workerURL:'https://quote.test',market:'TW',date:'2026-10-27',action:'close',reason:'manual',publish:true,
    expectedRevision:202602,fetchImpl,getToken:async()=>token()});
  expect(first).toMatchObject({published:true,revision:202603,expectedTradingDate:'2026-10-22',archive:{complete:false}});
  const stored=JSON.parse(objects.get('market-calendar/catalog.json')!);
  expect(stored.audit[0].approvedBy).toBe('github:chihkang/run:12345/attempt:1');
  const jwt=await token();
  for(const path of ['/admin/market-calendar/publish','/admin/tpex/eod/ingest']) {
    expect((await worker.fetch(new Request('https://quote.test'+path,{method:'POST',headers:{Authorization:'Bearer '+jwt},body:'{}'}),env)).status).toBe(401);
  }
  expect(await manageCalendar({workerURL:'https://quote.test',market:'TW',date:'2026-10-27',action:'reopen',reason:'revoke manual closure',publish:true,
    expectedRevision:202603,fetchImpl,getToken:async()=>token()})).toMatchObject({published:true,revision:202604,expectedTradingDate:'2026-10-27'});
});
