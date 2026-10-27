type ActionTrust = {CALENDAR_GITHUB_AUDIENCE?: string};
type ActionIdentity = {actor:string;runId:string;runAttempt:string};
const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object' && value!==null && !Array.isArray(value);
const decode=(value:string)=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const parse=(value:string):unknown=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(value)));
const reject=(reason:string):null=>{console.warn('calendar_action_auth_rejected',{reason});return null;};

// Disabled unless the deployment explicitly installs this narrow trust policy.
// No bearer token, signing key, or cloud credential is persisted by the Worker.
export async function authorizeCalendarAction(request:Request,env:ActionTrust):Promise<ActionIdentity|null> {
  const audience=env.CALENDAR_GITHUB_AUDIENCE;
  if (!audience || !audience.startsWith('https:') || audience!==request.url) return reject('configuration');
  const authorization=request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ') || authorization.length>16384) return reject('authorization');
  try {
    const parts=authorization.slice(7).split('.');
    if(parts.length!==3)return reject('format');
    const header=parse(parts[0]),claims=parse(parts[1]);
    if(!object(header) || header.alg!=='RS256' || typeof header.kid!=='string' || !object(claims))return reject('header');
    const now=Math.floor(Date.now()/1000);
    if(claims.iss!=='https://token.actions.githubusercontent.com' || claims.aud!==audience)return reject('issuer_audience');
    if(claims.repository!=='chihkang/quote' || claims.repository_id!=='1142362573' || claims.repository_owner_id!=='8790142')return reject('repository');
    if(claims.actor_id!=='8790142' || claims.actor!=='chihkang')return reject('actor');
    if(claims.ref!=='refs/heads/main'
      || claims.workflow_ref!=='chihkang/quote/.github/workflows/manage-market-calendar.yml@refs/heads/main'
      || claims.event_name!=='workflow_dispatch' || typeof claims.sub!=='string')return reject('workflow');
    if(typeof claims.iat!=='number' || typeof claims.exp!=='number' || typeof claims.nbf!=='number'
      || claims.iat>now+30 || claims.iat<now-600 || claims.exp<=now || claims.exp-claims.iat>600 || claims.nbf>now+30
      )return reject('token_time');
    if(typeof claims.run_id!=='string' || !/^\d+$/.test(claims.run_id)
      || typeof claims.run_attempt!=='string' || !/^\d+$/.test(claims.run_attempt))return reject('run_identity');
    const response=await fetch('https://token.actions.githubusercontent.com/.well-known/jwks',{redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)return reject('key_source_status');
    const reader=response.body?.getReader();if(!reader)return reject('key_source_empty');
    const chunks:Uint8Array[]=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return reject('key_source_size');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const jwks:unknown=JSON.parse(new TextDecoder().decode(bytes));
    if(!object(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length>20)return reject('key_source_format');
    const key=jwks.keys.find(value=>object(value) && value.kid===header.kid);
    if(!object(key) || key.kty!=='RSA' || key.alg!=='RS256' || key.use!=='sig' || typeof key.n!=='string' || typeof key.e!=='string')return reject('key_selection');
    const imported=await crypto.subtle.importKey('jwk',{kty:'RSA',n:key.n,e:key.e,alg:'RS256',ext:true},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',imported,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
    return valid ? {actor:claims.actor,runId:claims.run_id,runAttempt:claims.run_attempt} : reject('signature');
  } catch {return reject('verification_exception');}
}
