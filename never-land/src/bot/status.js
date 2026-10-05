'use strict';

/** Runtime-only state. It never contains a token, proxy secret, or OAuth data. */
const state = {
  state: 'disabled', // disabled | starting | ready | degraded | stopped
  startedAt: null,
  readyAt: null,
  guilds: 0,
  user: null,
  error: null,
  transport: 'not-configured',
};

function set(patch = {}) {
  Object.assign(state, patch);
  return get();
}

function get() {
  return { ...state };
}

module.exports = { get, set };
