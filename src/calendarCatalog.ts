import { calendarRevision, releasedCalendars, type CalendarRelease, type MarketCalendarData } from './marketCalendar';

export const CALENDAR_KEY = 'market-calendar/catalog.json';
const INITIALIZED_KEY = 'market-calendar/initialized.json';
const MAX_BYTES = 1024 * 1024;
type CalendarEntry = {effectiveFrom: string; sha256: string; document: string};
export type CalendarCatalog = {schemaVersion: 1; revision: number; calendars: CalendarEntry[]};
type Approval = {revision: number; approvedBy: string; reason: string; evidenceURLs: string[]; publishedAt: string};
type CalendarSnapshot = {catalog: CalendarCatalog; releases: readonly CalendarRelease[]; audit: Approval[]; etag: string | null};
type CalendarEnv = {TW_EOD_R2?: R2Bucket; ADMIN_REFRESH_TOKEN?: string; CALENDAR_STORAGE_REQUIRED?: string};

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && value >= '1912-01-01' && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value;
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export function officialEvidenceURL(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['www.twse.com.tw','www.tpex.org.tw','www.nyse.com'].includes(url.hostname);
  } catch { return false; }
}
export async function sha256(document: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(document));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
}

function parseDocument(value: unknown): MarketCalendarData {
  if (!object(value) || !text(value.calendarVersion,96) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value.calendarVersion)
    || !date(value.coverageStart) || !date(value.coverageEnd) || value.coverageStart > value.coverageEnd
    || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 16
    || !value.sources.every(source => {try {return typeof source === 'string' && new URL(source).protocol === 'https:';} catch {return false;}})
    || !value.sources.some(source => ['www.twse.com.tw','twse.com.tw'].includes(new URL(source).hostname))
    || !value.sources.some(source => ['www.nyse.com','nyse.com'].includes(new URL(source).hostname))) throw new Error('Invalid calendar document');
  const weekday = (day: string) => ![0,6].includes(new Date(day+'T12:00:00Z').getUTCDay());
  const market = (input: unknown, name: 'TW'|'US'): MarketCalendarData['TW'] => {
    if (!object(input) || !Array.isArray(input.holidays) || !object(input.earlyCloses)
      || input.holidays.length > 400 || Object.keys(input.earlyCloses).length > 100) throw new Error('Invalid market rules');
    const holidays: string[] = [];
    for (const day of input.holidays) {
      if (!date(day) || !weekday(day) || day < String(value.coverageStart) || day > String(value.coverageEnd)
        || (holidays.length > 0 && holidays[holidays.length-1] >= day)) throw new Error('Invalid holiday');
      holidays.push(day);
    }
    const earlyCloses: Record<string,string> = {};
    for (const [day, close] of Object.entries(input.earlyCloses)) {
      if (!date(day) || !weekday(day) || day < String(value.coverageStart) || day > String(value.coverageEnd)
        || typeof close !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(close) || holidays.includes(day)
        || close <= (name === 'TW' ? '09:00' : '09:30') || close >= (name === 'TW' ? '13:30' : '16:00')) throw new Error('Invalid early close');
      earlyCloses[day] = close;
    }
    return {holidays, earlyCloses};
  };
  return {calendarVersion:value.calendarVersion,coverageStart:value.coverageStart,coverageEnd:value.coverageEnd,TW:market(value.TW,'TW'),US:market(value.US,'US')};
}

export async function bundledCatalog(): Promise<CalendarCatalog> {
  return {schemaVersion:1,revision:calendarRevision,calendars:await Promise.all(releasedCalendars.map(async release => {
    const document = JSON.stringify(release.data);
    return {effectiveFrom:release.effectiveFrom,sha256:await sha256(document),document};
  }))};
}

export async function parseCatalog(value: unknown): Promise<{catalog: CalendarCatalog; releases: CalendarRelease[]}> {
  if (!object(value) || value.schemaVersion !== 1 || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision)
    || value.revision < calendarRevision || !Array.isArray(value.calendars) || !value.calendars.length || value.calendars.length > 100) throw new Error('Invalid calendar catalog');
  const calendars: CalendarEntry[] = [];
  const releases: CalendarRelease[] = [];
  for (const item of value.calendars) {
    if (!object(item) || !date(item.effectiveFrom) || typeof item.document !== 'string' || new TextEncoder().encode(item.document).length > 131072
      || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || await sha256(item.document) !== item.sha256) throw new Error('Invalid calendar digest');
    const data = parseDocument(JSON.parse(item.document));
    const effectiveFrom = item.effectiveFrom;
    if (item.effectiveFrom < data.coverageStart || item.effectiveFrom > data.coverageEnd
      || calendars.some(prior => prior.effectiveFrom > effectiveFrom)
      || releases.some(prior => prior.data.calendarVersion === data.calendarVersion)) throw new Error('Invalid calendar release ordering');
    calendars.push({effectiveFrom:item.effectiveFrom,sha256:item.sha256,document:item.document});
    releases.push({effectiveFrom:item.effectiveFrom,data});
  }
  const baseline = await bundledCatalog();
  if (!hasPrefix(calendars, baseline.calendars)) throw new Error('Published calendar history changed');
  return {catalog:{schemaVersion:1,revision:value.revision,calendars},releases};
}
const hasPrefix = (next: CalendarEntry[], previous: CalendarEntry[]) => previous.length <= next.length
  && previous.every((entry,index) => next[index].effectiveFrom === entry.effectiveFrom
    && next[index].sha256 === entry.sha256 && next[index].document === entry.document);

export async function loadCalendarCatalog(env: CalendarEnv, bootstrap = false): Promise<CalendarSnapshot> {
  const stored = await env.TW_EOD_R2?.get(CALENDAR_KEY);
  if (!stored) {
    if (await env.TW_EOD_R2?.get(INITIALIZED_KEY)) throw new Error('Initialized calendar catalog missing; manual recovery required');
    if (env.CALENDAR_STORAGE_REQUIRED === 'true' && !bootstrap) throw new Error('Calendar storage not initialized');
    return {catalog:await bundledCatalog(),releases:releasedCalendars,audit:[],etag:null};
  }
  if (stored.size > MAX_BYTES) throw new Error('Stored calendar too large');
  const value: unknown = await stored.json();
  if (!object(value) || !Array.isArray(value.audit)) throw new Error('Invalid publication record');
  const parsed = await parseCatalog(value.catalog);
  const audit: Approval[] = [];
  for (const entry of value.audit) {
    if (!object(entry) || typeof entry.revision !== 'number' || !Number.isSafeInteger(entry.revision)
      || !text(entry.approvedBy,100) || !text(entry.reason) || !text(entry.publishedAt,40) || !Number.isFinite(Date.parse(entry.publishedAt))
      || !Array.isArray(entry.evidenceURLs) || !entry.evidenceURLs.length || !entry.evidenceURLs.every(officialEvidenceURL)) throw new Error('Invalid approval history');
    audit.push({revision:entry.revision,approvedBy:entry.approvedBy,reason:entry.reason,publishedAt:entry.publishedAt,evidenceURLs:entry.evidenceURLs});
  }
  if (!audit.length || audit.at(-1)?.revision !== parsed.catalog.revision) throw new Error('Missing publication approval');
  return {...parsed,audit,etag:stored.etag};
}

const reply = (body: unknown, status = 200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export const calendarSourceError = () => reply({error:'Calendar source unavailable',complete:false,archiveStatus:'calendar_source_error'},503);

async function readBoundedJSON(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {await reader.cancel(); throw new Error('Calendar payload too large');}
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset += chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

export async function publishCalendar(request: Request, env: CalendarEnv): Promise<Response> {
  if (request.method !== 'POST') return reply({error:'Method Not Allowed'},405);
  if (!env.ADMIN_REFRESH_TOKEN || !env.TW_EOD_R2) return reply({error:'Calendar publication not configured'},503);
  if (request.headers.get('authorization') !== 'Bearer ' + env.ADMIN_REFRESH_TOKEN) return reply({error:'Unauthorized'},401);
  let input: unknown;
  let next: Awaited<ReturnType<typeof parseCatalog>>;
  try {
    input = await readBoundedJSON(request);
    if (!object(input) || !text(input.approvedBy,100) || !text(input.reason) || !Array.isArray(input.evidenceURLs)
      || !input.evidenceURLs.length || input.evidenceURLs.length > 10 || !input.evidenceURLs.every(officialEvidenceURL)
      || typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision)) throw new Error('Explicit approval and official evidence required');
    next = await parseCatalog(input.catalog);
  } catch (error) {return reply({error:error instanceof Error ? error.message : 'Invalid calendar'},400);}
  let current: CalendarSnapshot;
  try {current = await loadCalendarCatalog(env, true);} catch {return calendarSourceError();}
  if (next.catalog.revision === current.catalog.revision && JSON.stringify(next.catalog) === JSON.stringify(current.catalog) && current.audit.length) {
    return reply({published:true,alreadyPublished:true,revision:current.catalog.revision});
  }
  if (input.expectedRevision !== current.catalog.revision) return reply({error:'Calendar revision conflict',revision:current.catalog.revision},409);
  const isBootstrap = current.etag === null && JSON.stringify(next.catalog) === JSON.stringify(current.catalog);
  if (!isBootstrap && (next.catalog.revision <= current.catalog.revision || next.catalog.calendars.length <= current.catalog.calendars.length
    || !hasPrefix(next.catalog.calendars,current.catalog.calendars))) return reply({error:'Publication must append immutable versions and advance revision'},400);
  const audit: Approval = {revision:next.catalog.revision,approvedBy:input.approvedBy,reason:input.reason,
    evidenceURLs:input.evidenceURLs,publishedAt:new Date().toISOString()};
  const record = JSON.stringify({catalog:next.catalog,audit:[...current.audit,audit]});
  if (new TextEncoder().encode(record).length > MAX_BYTES) return reply({error:'Calendar payload too large'},413);
  const condition = new Headers(current.etag === null ? {'If-None-Match':'*'} : {'If-Match':'"' + current.etag + '"'});
  try {
    if (current.etag === null) {
      // Claim initialization before writing the catalog. A crash leaves a visible
      // recovery requirement instead of allowing a later revision rollback.
      const initialized = await env.TW_EOD_R2.put(INITIALIZED_KEY,JSON.stringify({initializedAt:audit.publishedAt,initialRevision:next.catalog.revision}),
        {onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/json'}});
      if (!initialized) return reply({error:'Calendar initialization already claimed; read catalog before retry'},409);
    }
    const written = await env.TW_EOD_R2.put(CALENDAR_KEY,record,{onlyIf:condition,httpMetadata:{contentType:'application/json'}});
    if (!written) return reply({error:'Concurrent calendar publication; reload and review'},409);
  } catch {return reply({error:'Calendar publication outcome uncertain; read catalog before retry'},503);}
  console.info('calendar_published',{revision:next.catalog.revision,versions:next.releases.map(release => release.data.calendarVersion)});
  return reply({published:true,alreadyPublished:false,revision:next.catalog.revision});
}
