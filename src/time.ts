export type TimeParts = {
  weekday: number; // 1 = Monday ... 7 = Sunday
  hour: number;
  minute: number;
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
