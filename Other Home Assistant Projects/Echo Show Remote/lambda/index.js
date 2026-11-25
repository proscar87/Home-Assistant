// Office Remote: a touch remote for the Office Apple TV on an Echo Show.
// Every tap is forwarded to a Home Assistant webhook, which runs the command.
const Alexa = require('ask-sdk-core');
const remoteDocument = require('./remote.json');

// App buttons. "source" must match the app name Home Assistant lists for the Apple TV.
const APPS = [
  { label: 'Netflix', source: 'Netflix' },
  { label: 'YouTube', source: 'YouTube' },
  { label: 'Disney+', source: 'Disney+' },
  { label: 'Prime Video', source: 'Prime Video' },
  { label: 'Spotify', source: 'Spotify' },
  { label: 'Apple TV', source: 'TV' },
];

const REMOTE_COMMANDS = new Set([
  'up', 'down', 'left', 'right', 'select', 'menu', 'home',
  'play_pause', 'skip_backward', 'skip_forward', 'volume_up', 'volume_down',
]);

function isAllowed(type, command) {
  if (type === 'remote') return REMOTE_COMMANDS.has(command);
  if (type === 'app') return APPS.some((app) => app.source === command);
  if (type === 'power') return command === 'off' || command === 'on';
  return false;
}

async function webhookUrl() {
  let value = process.env.HA_WEBHOOK_URL;
  const table = process.env.DYNAMODB_PERSISTENCE_TABLE_NAME;
  const region = process.env.DYNAMODB_PERSISTENCE_REGION;
  if (value === undefined && table && region) {
    try {
      // The Alexa-hosted Node 16 runtime includes the AWS SDK.
      const DynamoDB = require('aws-sdk').DynamoDB;
      const result = await new DynamoDB({ region }).getItem({
        TableName: table,
        Key: { id: { S: 'office-remote-config' } },
        ConsistentRead: true,
      }).promise();
      value = result.Item && result.Item.webhookUrl && result.Item.webhookUrl.S;
    } catch {
      throw new Error('Could not read the webhook setting from the skill database');
    }
  }
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) return url;
  } catch {
    // URL parsing errors may include the original credential.
  }
  throw new Error('Set a valid HTTPS webhook URL in the skill configuration');
}

async function sendToHomeAssistant(type, command) {
  if (!isAllowed(type, command)) throw new Error('Command not allowed');
  const url = await webhookUrl();
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ type, command });
    const transport = require('https');
    const request = transport.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 4000,
      },
      (response) => {
        response.on('error', reject);
        response.resume();
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve();
          else reject(new Error(`Home Assistant answered ${response.statusCode}`));
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('Home Assistant did not answer in time')));
    request.on('error', reject);
    request.end(body);
  }).catch(() => {
    throw new Error('Home Assistant did not complete the command');
  });
}

function hasScreen(handlerInput) {
  const interfaces = Alexa.getSupportedInterfaces(handlerInput.requestEnvelope);
  return Boolean(interfaces['Alexa.Presentation.APL']);
}

function showRemote(handlerInput) {
  return handlerInput.responseBuilder.addDirective({
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: 'office-remote',
    document: remoteDocument,
    datasources: {
      payload: {
        title: 'OFFICE · APPLE TV',
        hint: 'Say "Alexa, go home" to close the remote.',
        apps: APPS,
      },
    },
  });
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  handle(handlerInput) {
    if (!hasScreen(handlerInput)) {
      return handlerInput.responseBuilder
        .speak('The office remote needs a screen. Try it on your Echo Show.')
        .withShouldEndSession(true)
        .getResponse();
    }
    // No speech and no reprompt: the remote stays on screen with the microphone closed.
    return showRemote(handlerInput).getResponse();
  },
};

// A button on the screen was tapped. arguments = [type, command].
const TouchHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.APL.UserEvent';
  },
  async handle(handlerInput) {
    const [type, command] = handlerInput.requestEnvelope.request.arguments || [];
    try {
      await sendToHomeAssistant(type, command);
      return handlerInput.responseBuilder.getResponse();
    } catch (err) {
      console.log(`Touch command failed: ${err.message}`);
      return handlerInput.responseBuilder.speak("I couldn't reach Home Assistant.").getResponse();
    }
  },
};

// Spoken commands, for example "Alexa, ask office remote to press home".
const CommandIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'CommandIntent';
  },
  async handle(handlerInput) {
    const slot = Alexa.getSlot(handlerInput.requestEnvelope, 'command');
    const match = slot && slot.resolutions && slot.resolutions.resolutionsPerAuthority
      && slot.resolutions.resolutionsPerAuthority.find((r) => r.status.code === 'ER_SUCCESS_MATCH');
    const command = match && match.values[0].value.id;
    const builder = hasScreen(handlerInput) ? showRemote(handlerInput) : handlerInput.responseBuilder;
    if (!command) {
      return builder.speak("I don't know that button.").getResponse();
    }
    try {
      await sendToHomeAssistant('remote', command);
      return builder.speak('Okay.').getResponse();
    } catch (err) {
      console.log(`Voice command failed: ${err.message}`);
      return builder.speak("I couldn't reach Home Assistant.").getResponse();
    }
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const builder = hasScreen(handlerInput) ? showRemote(handlerInput) : handlerInput.responseBuilder;
    return builder.speak('Tap a button on the screen to control the office Apple TV.').getResponse();
  },
};

const StopHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope;
    return Alexa.getRequestType(request) === 'IntentRequest'
      && ['AMAZON.CancelIntent', 'AMAZON.StopIntent', 'AMAZON.NavigateHomeIntent'].includes(Alexa.getIntentName(request));
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.withShouldEndSession(true).getResponse();
  },
};

const SessionEndedHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput) {
    console.log('Unhandled skill error');
    return handlerInput.responseBuilder.speak('Something went wrong with the office remote.').getResponse();
  },
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    TouchHandler,
    CommandIntentHandler,
    HelpIntentHandler,
    StopHandler,
    SessionEndedHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
