const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let Card;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'atmosphere-card.js'),'utf8'),{
  HTMLElement:class {attachShadow(){}},customElements:{define(name,card){Card=card}},
  window:{YankeAppearance:{apply(){},fitViewport(){},releaseViewport(){}}},setInterval(){},clearInterval(){}
});
async function check(){
  const card=new Card(),subscriptions=[];
  card.render=()=>{};
  card.loadCalendar=()=>{};
  const connection={subscribeMessage(callback,request){
    return new Promise((resolve,reject)=>{
      const sub={callback,request,reject,closed:0,ready(){resolve(()=>{sub.closed++;});}};
      subscriptions.push(sub);
    });
  }};
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  card.hass={connection};
  card.connectedCallback();
  card.setConfig({entity:'weather.a'});
  const [hourA,dayA]=subscriptions;
  hourA.ready();
  hourA.callback({forecast:['first']});
  await flush();
  card.setConfig({entity:'weather.b'});
  assert.deepEqual(Object.keys(card.forecasts),[]);
  const [hourB,dayB]=subscriptions.slice(2);
  hourB.ready();
  card.setConfig({entity:'weather.a'});
  card.hass={connection};
  card.setConfig({entity:'weather.a'});
  const [hourNew,dayNew]=subscriptions.slice(4);
  assert.deepEqual(subscriptions.map(s=>[s.request.entity_id,s.request.forecast_type]),
    ['a','b','a'].flatMap(id=>['hourly','daily'].map(type=>['weather.'+id,type])));
  dayA.ready();
  dayB.reject(Error('old connection'));
  for(const sub of [hourA,dayA,hourB,dayB])sub.callback({forecast:['obsolete']});
  hourNew.ready();
  hourNew.callback({forecast:['current']});
  dayNew.callback({forecast:['daily']});
  await flush();
  assert.equal(card.forecasts.hourly[0],'current');
  assert.equal(card.forecasts.daily[0],'daily');
  assert.deepEqual([hourA.closed,dayA.closed,hourB.closed],[1,1,1]);
  card.disconnectedCallback();
  card.connectedCallback();
  dayNew.ready();
  hourNew.callback({forecast:['obsolete']});
  await flush();
  assert.deepEqual(Object.keys(card.forecasts),[]);
  assert.deepEqual([hourNew.closed,dayNew.closed],[1,1]);
  assert.equal(subscriptions.length,8);
  subscriptions[6].reject(Error('current error'));
  await flush();
  assert.equal(card.forecasts.hourly,null);
}
check().then(()=>console.log('Forecast lifecycle checks passed')).catch(error=>{console.error(error);process.exitCode=1;});
