import { isTradingSessionTW, secondsUntilNextTwOpen } from './time';

export type TTLPair = {
  soft: number;
  hard: number;
};

export type EnvLike = {
  TW_OPEN?: string;
  TW_CLOSE?: string;
  SOFT_TTL_TRADING_SEC?: string;
  HARD_TTL_TRADING_SEC?: string;
  SOFT_TTL_OFFHOURS_SEC?: string;
  HARD_TTL_OFFHOURS_SEC?: string;
};

const DEFAULTS = {
  SOFT_TTL_TRADING_SEC: 300,
  HARD_TTL_TRADING_SEC: 300,
  SOFT_TTL_OFFHOURS_SEC: 300,
  HARD_TTL_OFFHOURS_SEC: 259200
};

const TW_OPEN = '09:00';
const TW_CLOSE = '13:30';
const OPEN_BUFFER_SEC = 300;

export function getTtlSeconds(market: 'TW' | 'US', now: Date, env: EnvLike): TTLPair {
  const isTrading = market === 'TW' && isTradingSessionTW(now, TW_OPEN, TW_CLOSE);

  if (isTrading) {
    return {
      soft: Number(env.SOFT_TTL_TRADING_SEC ?? DEFAULTS.SOFT_TTL_TRADING_SEC),
      hard: Number(env.HARD_TTL_TRADING_SEC ?? DEFAULTS.HARD_TTL_TRADING_SEC)
    };
  }

  if (market === 'TW') {
    const soft = Number(env.SOFT_TTL_OFFHOURS_SEC ?? DEFAULTS.SOFT_TTL_OFFHOURS_SEC);
    const hard = secondsUntilNextTwOpen(now, TW_OPEN) + OPEN_BUFFER_SEC;
    return {
      soft,
      hard: Math.max(hard, soft)
    };
  }

  return {
    soft: Number(env.SOFT_TTL_OFFHOURS_SEC ?? DEFAULTS.SOFT_TTL_OFFHOURS_SEC),
    hard: Number(env.HARD_TTL_OFFHOURS_SEC ?? DEFAULTS.HARD_TTL_OFFHOURS_SEC)
  };
}
