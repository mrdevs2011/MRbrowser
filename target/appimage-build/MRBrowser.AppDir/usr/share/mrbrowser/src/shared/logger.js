'use strict';
/**
 * Lightweight structured logger for the main process.
 * Avoids heavy dependencies; safe in production builds.
 * @module shared/logger
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const current = process.env.MRB_LOG === 'debug' ? 10 : 20;

function emit(level, msg, meta) {
  if (LEVELS[level] < current) return;
  const line = meta !== undefined
    ? `[MRB ${level}] ${msg} ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`
    : `[MRB ${level}] ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  debug: (m, x) => emit('debug', m, x),
  info: (m, x) => emit('info', m, x),
  warn: (m, x) => emit('warn', m, x),
  error: (m, x) => emit('error', m, x),
};
