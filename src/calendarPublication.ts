import { bundledCatalog, type CalendarCatalog } from './calendarCatalog';

export async function calendarPublication(catalog?: CalendarCatalog): Promise<Response> {
  catalog ??= await bundledCatalog();
  return Response.json(catalog, {
    headers: {'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*'}
  });
}
