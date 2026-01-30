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

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};

const DAY_MS = 86_400_000;

export function getTaipeiParts(date = new Date()): TimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const weekday = WEEKDAY_MAP[parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'] ?? 1;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  return { weekday, hour, minute };
}

export function getTaipeiDateISO(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
}

export function parseHolidayList(value?: string): Set<string> {
  if (!value) return new Set();
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return new Set(items);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function isTradingDay(date: Date, holidays: Set<string>): boolean {
  const { weekday } = getTaipeiParts(date);
  if (weekday < 1 || weekday > 5) return false;
  const dateIso = getTaipeiDateISO(date);
  return !holidays.has(dateIso);
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
  const { hour: openHour, minute: openMinute } = parseTimeHHMM(open);
  const { hour: closeHour, minute: closeMinute } = parseTimeHHMM(close);

  if (parts.weekday < 1 || parts.weekday > 5) return false;

  const minutes = parts.hour * 60 + parts.minute;
  const openMinutes = openHour * 60 + openMinute;
  const closeMinutes = closeHour * 60 + closeMinute;

  return minutes >= openMinutes && minutes <= closeMinutes;
}

export function isTradingSessionTW(now = new Date(), open = '09:00', close = '13:30'): boolean {
  const parts = getTaipeiParts(now);
  return isTradingSessionTWParts(parts, open, close);
}

export function secondsUntilNextTwOpen(now = new Date(), open = '09:00'): number {
  const parts = getTaipeiParts(now);
  const { hour: openHour, minute: openMinute } = parseTimeHHMM(open);

  const openMinutes = openHour * 60 + openMinute;
  const nowMinutes = parts.hour * 60 + parts.minute;

  let daysUntilOpen = 0;

  if (parts.weekday >= 1 && parts.weekday <= 5) {
    if (nowMinutes < openMinutes) {
      daysUntilOpen = 0;
    } else if (parts.weekday === 5) {
      daysUntilOpen = 3;
    } else {
      daysUntilOpen = 1;
    }
  } else if (parts.weekday === 6) {
    daysUntilOpen = 2;
  } else {
    daysUntilOpen = 1;
  }

  const minutesUntil = daysUntilOpen * 1440 + (openMinutes - nowMinutes);
  return Math.max(0, minutesUntil * 60);
}

export function isTradingSessionUS(
  now = new Date(),
  open = '10:30',
  close = '05:00',
  holidays?: string
): boolean {
  const parts = getTaipeiParts(now);
  const { hour: openHour, minute: openMinute } = parseTimeHHMM(open);
  const { hour: closeHour, minute: closeMinute } = parseTimeHHMM(close);

  const minutes = parts.hour * 60 + parts.minute;
  const openMinutes = openHour * 60 + openMinute;
  const closeMinutes = closeHour * 60 + closeMinute;
  const overnight = openMinutes > closeMinutes;
  const holidaySet = parseHolidayList(holidays);

  let sessionDate = now;
  if (overnight && minutes <= closeMinutes) {
    sessionDate = addDays(now, -1);
  }

  if (!isTradingDay(sessionDate, holidaySet)) return false;

  if (overnight) {
    return minutes >= openMinutes || minutes <= closeMinutes;
  }

  return minutes >= openMinutes && minutes <= closeMinutes;
}

export function secondsUntilNextUsOpen(
  now = new Date(),
  open = '10:30',
  holidays?: string
): number {
  const { hour: openHour, minute: openMinute } = parseTimeHHMM(open);
  const openMinutes = openHour * 60 + openMinute;

  const nowParts = getTaipeiParts(now);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const holidaySet = parseHolidayList(holidays);

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const candidateDate = addDays(now, dayOffset);
    if (!isTradingDay(candidateDate, holidaySet)) {
      continue;
    }

    if (dayOffset === 0 && nowMinutes >= openMinutes) {
      continue;
    }

    const minutesUntil = dayOffset * 1440 + (openMinutes - nowMinutes);
    return Math.max(0, minutesUntil * 60);
  }

  return 0;
}
