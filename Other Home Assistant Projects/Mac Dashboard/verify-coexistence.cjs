const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dashboards = [
  ['Mac Dashboard', 'yanke-mac-dashboard', 'example_macbook'],
  ['Office set up', 'yanke-office-studio', 'kriss_macbook_pro']
];

async function check(order) {
  const registry = new Map();
  const context = vm.createContext({
    HTMLElement: class { attachShadow() {} },
    customElements: {
      get: name => registry.get(name),
      define(name, ctor) {
        assert(!registry.has(name));
        assert(![...registry.values()].includes(ctor));
        registry.set(name, ctor);
      }
    }
  });
  for (const [index, [directory, type, prefix]] of order.entries()) {
    const folder = path.join(__dirname, '..', directory);
    const example = JSON.parse(fs.readFileSync(path.join(folder, 'dashboard.json')));
    assert.equal(example.views[0].cards[0].type, 'custom:' + type);
    vm.runInContext(fs.readFileSync(path.join(folder, 'mac-studio.bundle.js'), 'utf8'), context);
    const old = new (registry.get('yanke-mac-studio'))();
    if (index === 0) {
      old.setConfig({});
      assert.equal(old.entities.volume, 'number.' + prefix + '_volume');
    } else {
      assert.throws(() => old.setConfig({}), /Choose custom:/);
    }
  }
  for (const [, type] of dashboards) {
    const calls = [];
    const states = {};
    const cards = ['desk', 'studio'].map(device => {
      const card = new (registry.get(type))();
      card.setConfig({entities: {
        connection: 'binary_sensor.' + device,
        volume: 'number.' + device,
        light: 'light.' + device
      }});
      states[card.entities.connection] = {state:'on'};
      states[card.entities.volume] = {state:device === 'desk' ? '12' : '35'};
      states[card.entities.light] = {state:'off'};
      card._hass = {connected:true, states, callService:async (domain, service, data) => calls.push([domain, service, data.entity_id])};
      card.syncLight = card.feedback = () => {};
      return card;
    });
    assert.deepEqual(cards.map(c => c.state('volume').state), ['12','35']);
    for (const card of cards) {
      await card.command('volume', 20);
      await card.lightCommand('toggle');
    }
    assert.deepEqual(calls, [
      ['number','set_value','number.desk'], ['light','turn_on','light.desk'],
      ['number','set_value','number.studio'], ['light','turn_on','light.studio']
    ]);
    assert.throws(() => cards[0].setConfig({entities:{volume:'light.desk'}}), /Invalid entity/);
  }
}
(async () => {
  await check(dashboards);
  await check([...dashboards].reverse());
  console.log('PASS: both bundle orders, example card types, single-bundle legacy names and isolated entity mappings.');
})().catch(error => { console.error(error); process.exitCode = 1; });
