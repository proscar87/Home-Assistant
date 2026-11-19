const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const context = vm.createContext({HTMLElement: class {}, customElements: {get: () => true}});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../custom_components/outage_watch/www/outage-watch-card.js"), "utf8"), context);
const start = Date.now() / 1000 - 18000;
for (const detailed of [false, true]) {
  test(detailed ? "detail chart" : "compact chart", () => {
    function trace(times, interval) {
      const history = times.map(([offset, state = "ok", cadence = interval]) =>
        cadence === undefined ? [start + offset, state, 12] : [start + offset, state, 12, cadence]);
      const svg = context.graph({history}, detailed);
      return [svg.match(/class="trace" d="([^"]*)"/)[1].replace(/[^ML]/g, ""), (svg.match(/<circle/g) || []).length];
    }
    assert.deepEqual(trace([[0], [60], [300]], 60), ["MLL", 0]);
    assert.deepEqual(trace([[0], [60, "failed"], [120]], 60), ["MM", 2]);
    assert.deepEqual(trace([[0], [7200], [7260]], 60), ["MML", 1]);
    assert.deepEqual(trace([[0], [1200, "ok", 300], [1800, "ok", 60]], 60), ["MLM", 1]);
    assert.deepEqual(trace([[0]], 60), ["M", 1]);
    assert.deepEqual(trace([[0], [1200], [3600]]), ["MLM", 1]);
  });
}
