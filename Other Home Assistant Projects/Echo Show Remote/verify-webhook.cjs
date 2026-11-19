const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'lambda/index.js'), 'utf8');
const secret = 'dummy-private-value';
const endpoint = 'https://example.invalid/' + secret;

async function tap(env, stored, failure) {
  const logs = [];
  const posts = [];
  const reads = [];
  let handlers;
  const builder = {
    addRequestHandlers(...registered) { handlers = registered; return this; },
    addErrorHandlers() { return this; },
    lambda() {},
  };
  class DynamoDB {
    constructor(options) { assert.equal(options.region, 'test-region'); }
    getItem(input) {
      reads.push(JSON.parse(JSON.stringify(input)));
      return { promise: async () => {
        if (failure === 'database') throw Error(secret);
        return stored ? { Item: { webhookUrl: { S: stored } } } : {};
      } };
    }
  }
  const modules = {
    './remote.json': {},
    'ask-sdk-core': { SkillBuilders: { custom: () => builder }, getRequestType: e => e.request.type },
    'aws-sdk': { DynamoDB },
    https: { request(url, options, callback) {
      assert.equal(options.method, 'POST');
      if (failure === 'synchronous') throw Error(secret);
      const request = new EventEmitter();
      request.end = body => {
        posts.push([url.href, JSON.parse(body)]);
        if (failure === 'network') return request.emit('error', Error(secret));
        const response = new EventEmitter();
        response.resume = () => {};
        response.statusCode = 204;
        callback(response);
        response.emit('end');
      };
      return request;
    } },
  };
  vm.runInNewContext(source, {
    exports: {}, process: { env }, URL, Buffer,
    require: name => { assert.ok(name in modules); return modules[name]; },
    console: { log: message => logs.push(message) },
  });
  const responseBuilder = {
    speech: '', speak(message) { this.speech = message; return this; },
    getResponse() { return this.speech; },
  };
  const input = {
    requestEnvelope: { request: { type: 'Alexa.Presentation.APL.UserEvent', arguments: ['remote', 'home'] } },
    responseBuilder,
  };
  const speech = await handlers.find(handler => handler.canHandle(input)).handle(input);
  assert.ok(![...logs, speech].join(' ').includes(secret));
  return { posts, reads, speech };
}

(async () => {
  const hosted = { DYNAMODB_PERSISTENCE_TABLE_NAME: 'skill-table', DYNAMODB_PERSISTENCE_REGION: 'test-region' };
  for (const useDatabase of [false, true]) {
    const env = useDatabase ? hosted : { ...hosted, HA_WEBHOOK_URL: endpoint };
    const result = await tap(env, useDatabase ? endpoint : undefined);
    assert.deepEqual(result.posts, [[endpoint, { type: 'remote', command: 'home' }]]);
    assert.equal(result.speech, '');
    assert.deepEqual(result.reads, useDatabase ? [{
      TableName: 'skill-table', Key: { id: { S: 'office-remote-config' } }, ConsistentRead: true,
    }] : []);
  }
  for (const env of [{}, hosted, ...['', secret, 'http://example.invalid/' + secret,
    'https://user:' + secret + '@example.invalid/'].map(value => ({ ...hosted, HA_WEBHOOK_URL: value }))]) {
    const result = await tap(env);
    assert.deepEqual(result.posts, []);
    assert.ok(result.speech);
  }
  for (const failure of ['database', 'network', 'synchronous']) {
    assert.ok((await tap(hosted, endpoint, failure)).speech);
  }
  console.log('Passed webhook configuration, outgoing command and redacted failure checks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
