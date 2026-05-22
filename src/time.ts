export type TimeParts = {
  weekday: number; // 1 = Monday ... 7 = Sunday
  hour: number;
  minute: number;
};

export type DateParts = {
  year: number;
  month: number;
  day: number;
};

type DateTimeParts = DateParts & TimeParts;
type SessionWindow = {
  openMinutes: number;
  closeMinutes: number;
};
type FormatterKind = 'dateTime' | 'offset';

export const DEFAULT_TW_OPEN = '09:00';
export const DEFAULT_TW_CLOSE = '13:30';

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};

const TAIPEI_TIME_ZONE = 'Asia/Taipei';
const NEW_YORK_TIME_ZONE = 'America/New_York';
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string, kind: FormatterKind): Intl.DateTimeFormat {
  const cacheKey = `${kind}:${timeZone}`;
  const cached = formatterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const formatter =
    kind === 'offset'
      ? new Intl.DateTimeFormat('en-US', {
          timeZone,
          timeZoneName: 'shortOffset',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
      : new Intl.DateTimeFormat('en-US', {
          timeZone,
          weekday: 'short',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });

  formatterCache.set(cacheKey, formatter);
  return formatter;
}

function getPartMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatDateIso({ year, month, day }: DateParts): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

function toMinutes(parts: { hour: number; minute: number }): number {
  return parts.hour * 60 + parts.minute;
}

function getSessionWindow(open: string, close: string): SessionWindow {
  const openParts = parseTimeHHMM(open);
  const closeParts = parseTimeHHMM(close);

  return {
    openMinutes: toMinutes(openParts),
    closeMinutes: toMinutes(closeParts)
  };
}

function isWithinSessionWindow(parts: TimeParts, window: SessionWindow): boolean {
  if (!isWeekday(parts.weekday)) return false;
  const minutes = toMinutes(parts);
  return minutes >= window.openMinutes && minutes <= window.closeMinutes;
}

function getDaysUntilNextWeekdayOpen(
  weekday: number,
  nowMinutes: number,
  openMinutes: number
): number {
  if (isWeekday(weekday)) {
    if (nowMinutes < openMinutes) {
      return 0;
    }
    return weekday === 5 ? 3 : 1;
  }

  return weekday === 6 ? 2 : 1;
}

const US_MARKET_OPEN = parseTimeHHMM('09:30');
const US_MARKET_WINDOW = getSessionWindow('09:30', '16:00');

function getDateTimeParts(date: Date, timeZone: string): DateTimeParts {
  const values = getPartMap(getFormatter(timeZone, 'dateTime').formatToParts(date));
  const weekday = WEEKDAY_MAP[values.weekday ?? 'Mon'] ?? 1;
  const year = Number(values.year ?? '1970');
  const month = Number(values.month ?? '1');
  const day = Number(values.day ?? '1');
  const hour = Number(values.hour ?? '0');
  const minute = Number(values.minute ?? '0');

  return { weekday, year, month, day, hour, minute };
}

function getDateIso(date: Date, timeZone: string): string {
  return formatDateIso(getDateTimeParts(date, timeZone));
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const values = getPartMap(getFormatter(timeZone, 'offset').formatToParts(date));
  const offsetValue = values.timeZoneName ?? 'GMT';

  if (offsetValue === 'GMT') {
    return 0;
  }

  const match = offsetValue.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) {
    return 0;
  }

  const [, sign, hours, minutes = '00'] = match;
  const totalMinutes = Number(hours) * 60 + Number(minutes);
  return sign === '+' ? totalMinutes : -totalMinutes;
}

function zonedDateTimeToUtc(dateParts: DateParts, hour: number, minute: number, timeZone: string): Date {
  const localUtcMillis = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute);
  const initialGuess = new Date(localUtcMillis);
  const initialOffsetMinutes = getTimeZoneOffsetMinutes(initialGuess, timeZone);
  const correctedUtcMillis = localUtcMillis - initialOffsetMinutes * 60_000;
  const correctedDate = new Date(correctedUtcMillis);
  const correctedOffsetMinutes = getTimeZoneOffsetMinutes(correctedDate, timeZone);

  if (correctedOffsetMinutes === initialOffsetMinutes) {
    return correctedDate;
  }

  return new Date(localUtcMillis - correctedOffsetMinutes * 60_000);
}

function addDaysToDateParts(dateParts: DateParts, days: number, timeZone: string): DateParts {
  const anchor = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + days, 12));
  const { year, month, day } = getDateTimeParts(anchor, timeZone);
  return { year, month, day };
}

export function getTaipeiParts(date = new Date()): TimeParts {
  const { weekday, hour, minute } = getDateTimeParts(date, TAIPEI_TIME_ZONE);
  return { weekday, hour, minute };
}

export function getTaipeiDateISO(date = new Date()): string {
  return getDateIso(date, TAIPEI_TIME_ZONE);
}

export function getNewYorkDateISO(date = new Date()): string {
  return getDateIso(date, NEW_YORK_TIME_ZONE);
}

export function parseHolidayList(value?: string): Set<string> {
  if (!value) return new Set();
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return new Set(items);
}

function isTradingDay(parts: DateParts & { weekday: number }, holidays: Set<string>): boolean {
  return isWeekday(parts.weekday) && !holidays.has(formatDateIso(parts));
}

export function parseTimeHHMM(value: string): { hour: number; minute: number } {
  const [hourStr, minuteStr] = value.split(':');
  const hour = Number(hourStr ?? '0');
  const minute = Number(minuteStr ?? '0');
  return { hour, minute };
}

export function isTradingSessionTWParts(
  parts: TimeParts,
  open: string,
  close: string
): boolean {
  return isWithinSessionWindow(parts, getSessionWindow(open, close));
}

export function isTradingSessionTW(
  now = new Date(),
  open = DEFAULT_TW_OPEN,
  close = DEFAULT_TW_CLOSE
): boolean {
  const parts = getTaipeiParts(now);
  return isTradingSessionTWParts(parts, open, close);
}

export function secondsUntilNextTwOpen(
  now = new Date(),
  open = DEFAULT_TW_OPEN,
  bufferSec = 0
): number {
  const parts = getTaipeiParts(now);
  const openMinutes = toMinutes(parseTimeHHMM(open));
  const nowMinutes = toMinutes(parts);
  const daysUntilOpen = getDaysUntilNextWeekdayOpen(parts.weekday, nowMinutes, openMinutes);

  const minutesUntil = daysUntilOpen * 1440 + (openMinutes - nowMinutes);
  return Math.max(0, minutesUntil * 60 + bufferSec);
}

export function isTradingSessionUS(
  now = new Date(),
  holidays?: string
): boolean {
  const parts = getDateTimeParts(now, NEW_YORK_TIME_ZONE);
  const holidaySet = parseHolidayList(holidays);
  return isTradingDay(parts, holidaySet) && isWithinSessionWindow(parts, US_MARKET_WINDOW);
}

export function secondsUntilNextUsOpen(
  now = new Date(),
  holidays?: string,
  bufferSec = 0
): number {
  const currentParts = getDateTimeParts(now, NEW_YORK_TIME_ZONE);
  const openMinutes = US_MARKET_WINDOW.openMinutes;
  const nowMinutes = toMinutes(currentParts);
  const holidaySet = parseHolidayList(holidays);
  const currentDate = {
    year: currentParts.year,
    month: currentParts.month,
    day: currentParts.day
  };

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const candidateDate = addDaysToDateParts(currentDate, dayOffset, NEW_YORK_TIME_ZONE);
    if (dayOffset === 0 && nowMinutes >= openMinutes) {
      continue;
    }

    const openAt = zonedDateTimeToUtc(candidateDate, US_MARKET_OPEN.hour, US_MARKET_OPEN.minute, NEW_YORK_TIME_ZONE);
    if (!isTradingDay(getDateTimeParts(openAt, NEW_YORK_TIME_ZONE), holidaySet)) {
      continue;
    }

    const secondsUntil = Math.ceil((openAt.getTime() - now.getTime()) / 1000);
    return Math.max(0, secondsUntil + bufferSec);
  }

  return 0;
}
