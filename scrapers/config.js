/**
 * scrapers/config.js
 *
 * Compatibility shim. Original scraper files do `require("./config")` and
 * read properties like `config.ANOOSH_API`, `config.COMPETITORS`, etc.
 *
 * In the SaaS, each job has its own config object. Before invoking any
 * scraper function, `lib/job-runner.ts` calls `setActiveConfig(cfg)`.
 * The Proxy below transparently forwards property access to the active cfg.
 *
 * SAFETY: This is a process-global singleton — it works because the worker
 * runs ONE job at a time. If you ever change to multiple workers IN THE SAME
 * PROCESS, switch to AsyncLocalStorage. (Multiple worker PROCESSES are fine.)
 */

let _active = null;

function setActiveConfig(cfg) { _active = cfg; }
function clearActiveConfig()  { _active = null; }

const handler = {
  get(_target, prop) {
    if (prop === '__setActiveConfig')  return setActiveConfig;
    if (prop === '__clearActiveConfig') return clearActiveConfig;
    if (!_active) {
      throw new Error(`scrapers/config.js: no active config set (tried to read .${String(prop)})`);
    }
    return _active[prop];
  },
  has(_target, prop) {
    return _active != null && prop in _active;
  },
};

module.exports = new Proxy({}, handler);
