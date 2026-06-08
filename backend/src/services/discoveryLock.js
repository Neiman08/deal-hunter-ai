/**
 * Global discovery lock — ensures only ONE discovery run executes at a time.
 * Prevents browser context contamination when multiple stores run in parallel.
 *
 * Usage:
 *   const { acquireLock, releaseLock, getStatus, requestStop } = require('./discoveryLock');
 *
 *   if (!acquireLock('gamestop')) return res.json({ error: 'Discovery already running' });
 *   try { await runDiscovery(); } finally { releaseLock(); }
 */

let _locked       = false;
let _store        = null;
let _startedAt    = null;
let _stopRequested = false;

function acquireLock(storeSlug) {
  if (_locked) return false;
  _locked        = true;
  _store         = storeSlug;
  _startedAt     = new Date().toISOString();
  _stopRequested = false;
  return true;
}

function releaseLock() {
  _locked        = false;
  _store         = null;
  _startedAt     = null;
  _stopRequested = false;
}

function requestStop() {
  _stopRequested = true;
}

function isStopRequested() {
  return _stopRequested;
}

function getStatus() {
  return {
    running:        _locked,
    store:          _store,
    started_at:     _startedAt,
    stop_requested: _stopRequested,
  };
}

module.exports = { acquireLock, releaseLock, requestStop, isStopRequested, getStatus };
