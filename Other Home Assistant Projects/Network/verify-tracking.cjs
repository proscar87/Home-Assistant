const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
let Card;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "network-console.js"), "utf8"), {
  HTMLElement: class {}, customElements: {get() {}, define(tag, cls) { Card = cls; }},
});
function fixture() {
  const card = Object.create(Card.prototype);
  card.reg = {};
  card.scan = {events: [], lastIp: {}};
  card._hass = {states: {}};
  card.note = () => {};
  card.renderScan = () => {};
  return card;
}

test("bulk and individual enrollment check current registry eligibility", async () => {
  const card = fixture();
  const entries = [null, "integration", "user", "config_entry", "device", "hass"].map((disabled_by, i) =>
    ({entity_id: "device_tracker.d" + i, disabled_by, platform: "nmap_tracker"}));
  entries.push({entity_id: "device_tracker.unrelated", platform: "other", disabled_by: "integration"});
  const updates = [];
  card._hass.callWS = async msg => {
    if (msg.type.endsWith("/list")) return entries;
    updates.push(msg.entity_id);
    return {};
  };
  await card.track("all");
  assert.deepEqual(updates, ["device_tracker.d1"]);
  await card.track("device_tracker.d2");
  assert.equal(updates.length, 1);
  assert.equal(card.scanModel().find(d => d.id === "device_tracker.d2").status, "disabled");
  card._hass.callWS = async () => { throw Error("registry unavailable"); };
  await card.track("all");
  assert.equal(card.regOk, false);
});

test("history distinguishes outages, emptiness and stale observations", async () => {
  const card = fixture(), id = "device_tracker.device";
  card.regOk = true;
  card.reg[id] = {};
  const tracked = [{id, name: "Laptop"}];
  const fail = async () => { throw Error("offline"); };
  card._hass.callApi = fail;
  await card.loadActivity();
  assert.match(card.activityMarkup(tracked), /unavailable/);
  card._hass.callApi = async () => [];
  await card.loadActivity();
  assert.match(card.activityMarkup(tracked), /No devices joined/);
  const now = Date.now();
  card._hass.callApi = async () => [[
    {entity_id: id, state: "not_home", last_changed: new Date(now - 6000)},
    {state: "home", last_changed: new Date(now - 3000)},
  ]];
  await card.loadActivity();
  card._hass.callApi = fail;
  await card.loadActivity();
  assert.match(card.activityMarkup(tracked), /Last successful refresh.*Laptop/);
  card.scan.events[0].t = now - 86400000;
  assert.doesNotMatch(card.activityMarkup(tracked), /Laptop/);
  let finish;
  card._hass.callApi = () => new Promise(resolve => { finish = resolve; });
  const pending = card.loadActivity();
  card.reg = {};
  await card.loadActivity();
  finish([[{entity_id: id, state: "home", last_changed: new Date(now)}]]);
  await pending;
  assert.equal(card.scan.events.length, 0);
  assert.match(card.activityMarkup([]), /No devices joined/);
});
