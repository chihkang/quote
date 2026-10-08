import { calendarRevision, releasedCalendars } from './marketCalendar';

export async function calendarPublication(): Promise<Response> {
  const calendars = await Promise.all(releasedCalendars.map(async release => {
    const document = JSON.stringify(release.data);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(document));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { effectiveFrom: release.effectiveFrom, sha256, document };
  }));
  return Response.json({schemaVersion: 1, revision: calendarRevision, calendars}, {
    headers: {'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*'}
  });
}
