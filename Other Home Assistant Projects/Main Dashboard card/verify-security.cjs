const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let Card;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'yanke-pulse-card.js'),'utf8'),{
  HTMLElement:class {},window:{},customElements:{get(){},define(name,card){Card=card}}
});
function display(alarm,lock,...doors){
  const labels={},states={};
  function set(id,state){if(state!==undefined)states[id]={state,attributes:{}};}
  set('alarm_control_panel.qolsys_panel_system',alarm);
  set('lock.smart_lock',lock);
  ['front','basement','garage'].forEach((door,i)=>set('binary_sensor.qolsys_panel_'+door+'_door',doors[i]));
  const card=Object.assign(Object.create(Card.prototype),{
    _hass:{states},tick(){},moon(){},seed(){},icon(){},tone(){},t(key,text){labels[key]=text;},
    shadowRoot:{querySelector(){return {dataset:{},style:{setProperty(){}}};}}
  });
  card.update();
  return labels;
}
let d=display('armed_home','locked','off','off','off');
assert.equal(d.doors,'All closed');
assert.equal(d.headline,'Armed and all secure.');
d=display(undefined,undefined);
assert.equal(d.doors,'3 unknown');
assert.match(d.headline,/Alarm status unavailable.*Lock status unavailable.*3 entryway statuses unknown/);
d=display('disarmed','locked','on','off','unavailable');
assert.equal(d.doors,'1 open · 1 unknown');
assert.match(d.headline,/Front door is open.*1 entryway status unknown/);
for(const state of ['unknown','arming','pending','disarming','triggered','armed_custom_bypass','unexpected']){
  assert.doesNotMatch(display(state,'locked','off','off','off').headline,/secure|closed up/);
}
for(const state of ['unknown','jammed','locking','unlocking','unexpected']){
  assert.doesNotMatch(display('armed_home',state,'off','off','off').headline,/secure|closed up/);
}
console.log('Security summary checks passed');
