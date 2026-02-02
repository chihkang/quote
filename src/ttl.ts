import {
  isTradingSessionTW,
  isTradingSessionUS,
  secondsUntilNextTwOpen,
  secondsUntilNextUsOpen
} from './time';

export type TTLPair = {
  soft: number;
  hard: number;
};

export type EnvLike = {
  TW_OPEN?: string;
  TW_CLOSE?: string;
  US_OPEN?: string;
  US_CLOSE?: string;
  US_HOLIDAYS?: string;
  SOFT_TTL_TRADING_SEC?: string;
  HARD_TTL_TRADING_SEC?: string;
  SOFT_TTL_OFFHOURS_SEC?: string;
  HARD_TTL_OFFHOURS_SEC?: string;
  OFFHOURS_OPEN_BUFFER_SEC?: string;
};

const DEFAULTS = {
  SOFT_TTL_TRADING_SEC: 300,
  HARD_TTL_TRADING_SEC: 300,
  SOFT_TTL_OFFHOURS_SEC: 300,
  HARD_TTL_OFFHOURS_SEC: 259200,
  OFFHOURS_OPEN_BUFFER_SEC: 180
};

const TW_OPEN = '09:00';
const TW_CLOSE = '13:30';
const US_OPEN = '10:30';
const US_CLOSE = '05:00';

export function getTtlSeconds(market: 'TW' | 'US', now: Date, env: EnvLike): TTLPair {
  const twOpen = env.TW_OPEN ?? TW_OPEN;
  const twClose = env.TW_CLOSE ?? TW_CLOSE;
  const usOpen = env.US_OPEN ?? US_OPEN;
  const usClose = env.US_CLOSE ?? US_CLOSE;
  const usHolidays = env.US_HOLIDAYS ?? '';
  const openBufferRaw = Number(env.OFFHOURS_OPEN_BUFFER_SEC ?? DEFAULTS.OFFHOURS_OPEN_BUFFER_SEC);
  const openBufferSec = Number.isFinite(openBufferRaw)
    ? Math.max(0, openBufferRaw)
    : DEFAULTS.OFFHOURS_OPEN_BUFFER_SEC;

  const isTwTrading = market === 'TW' && isTradingSessionTW(now, twOpen, twClose);
  const isUsTrading = market === 'US' && isTradingSessionUS(now, usOpen, usClose, usHolidays);

  if (isTwTrading) {
    return {
      soft: Number(env.SOFT_TTL_TRADING_SEC ?? DEFAULTS.SOFT_TTL_TRADING_SEC),
      hard: Number(env.HARD_TTL_TRADING_SEC ?? DEFAULTS.HARD_TTL_TRADING_SEC)
    };
  }

  if (market === 'TW') {
    const soft = Number(env.SOFT_TTL_OFFHOURS_SEC ?? DEFAULTS.SOFT_TTL_OFFHOURS_SEC);
    const hard = secondsUntilNextTwOpen(now, twOpen, openBufferSec);
    return {
      soft,
      hard: Math.max(hard, soft)
    };
  }

  if (isUsTrading) {
    const soft = Math.min(
      Number(env.SOFT_TTL_TRADING_SEC ?? DEFAULTS.SOFT_TTL_TRADING_SEC),
      300
    );
    const hard = Math.min(
      Number(env.HARD_TTL_TRADING_SEC ?? DEFAULTS.HARD_TTL_TRADING_SEC),
      300
    );
    return {
      soft: Math.max(0, soft),
      hard: Math.max(0, hard)
    };
  }

  const offHoursSoft = Number(env.SOFT_TTL_OFFHOURS_SEC ?? DEFAULTS.SOFT_TTL_OFFHOURS_SEC);
  const offHoursHard = secondsUntilNextUsOpen(now, usOpen, usHolidays, openBufferSec);
  return {
    soft: offHoursSoft,
    hard: Math.max(offHoursHard, offHoursSoft)
  };
}
