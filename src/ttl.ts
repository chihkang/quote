import { isTradingSessionTW } from './time';

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
  HARD_TTL_TRADING_SEC: 129600,
  SOFT_TTL_OFFHOURS_SEC: 43200,
  HARD_TTL_OFFHOURS_SEC: 259200
};

export function getTtlSeconds(market: 'TW' | 'US', now: Date, env: EnvLike): TTLPair {
  const open = env.TW_OPEN ?? '09:00';
  const close = env.TW_CLOSE ?? '13:30';

  const isTrading = market === 'TW' && isTradingSessionTW(now, open, close);

  if (isTrading) {
    return {
      soft: Number(env.SOFT_TTL_TRADING_SEC ?? DEFAULTS.SOFT_TTL_TRADING_SEC),
      hard: Number(env.HARD_TTL_TRADING_SEC ?? DEFAULTS.HARD_TTL_TRADING_SEC)
    };
  }

  return {
    soft: Number(env.SOFT_TTL_OFFHOURS_SEC ?? DEFAULTS.SOFT_TTL_OFFHOURS_SEC),
    hard: Number(env.HARD_TTL_OFFHOURS_SEC ?? DEFAULTS.HARD_TTL_OFFHOURS_SEC)
  };
}
