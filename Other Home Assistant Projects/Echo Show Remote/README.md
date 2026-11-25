# Echo Show Remote

A touch remote for the Office Apple TV on an Echo Show. It is an Alexa skill ("Office Remote"):
taps go from the skill to a Home Assistant webhook, which presses the button on the Apple TV.
Home Assistant opens the skill on the Echo Show when the Apple TV turns on.

| File | What it is |
|------|------------|
| `interaction-model.json` | The skill's voice model (invocation name "office remote") |
| `lambda/index.js` | The skill code; forwards taps to the Home Assistant webhook |
| `lambda/remote.json` | The on-screen remote (APL), scaled to fit any Echo Show |
| `lambda/package.json` | Dependencies for the Alexa-hosted skill |
| `automations.yaml` | The two Home Assistant automations, with a placeholder webhook ID |

Needs Home Assistant Cloud (Nabu Casa) for the webhook and Alexa Media Player for the automatic opening.

## Before you start

- **Alexa+ blocks this skill.** With Alexa+ on, the Echo Show answers "not supported on this device". It works with Alexa+ turned off.
- **The skill's language must match the Echo Show's.** A device set to English (Canada) cannot see a skill that only has English (US).
- Use a private development skill for your household. Anyone who can invoke this skill can control the configured Apple TV.
- Create the two automations from `automations.yaml` first, with your own webhook ID and entity IDs.

## 1. Get the webhook URL from Home Assistant

1. Open **Settings → Home Assistant Cloud → Webhooks**.
2. Turn on the webhook for **Office Remote: Echo Show commands**.
3. Copy the URL it shows. Treat it like a password.

## 2. Create the skill

1. Go to <https://developer.amazon.com/alexa/console/ask> and sign in with the **same Amazon
   account your Echo Show uses**.
2. **Create Skill**: name `Office Remote`, locale **English (CA)**, model **Custom**,
   hosting **Alexa-hosted (Node.js)**, template **Start from Scratch**. If you operate your own AWS Lambda function, choose **Provision your own** and follow the Lambda instructions below.

## 3. Build tab

1. **Interfaces**: turn on **Alexa Presentation Language**, tick **every Hub profile**
   (the Echo Show 8 is Hub Landscape Medium), then **Save**.
2. **Interaction Model → JSON Editor**: replace everything with the contents of
   `interaction-model.json`, then **Save** and **Build skill**.

## 4. Configure the skill endpoint

### Alexa-hosted Node.js

1. In the skill's **Code** tab, copy `lambda/index.js`, `lambda/package.json` and
   `lambda/remote.json` into the corresponding files under `lambda/`.
2. Select **Database** in the toolbar to open the DynamoDB table for this skill. Under
   **Explore table items**, choose **Create item**. Set the string partition key
   `id` to `office-remote-config`. Add a string attribute named `webhookUrl` and
   paste the HTTPS URL from step 1 into its value. Save the item.
3. In the Code tab, **Save** and **Deploy**. The skill reads the table when it sends
   a command. Limit access to the skill and its database to trusted administrators.

[Amazon's guide to the Alexa-hosted skill database](https://developer.amazon.com/en-US/docs/alexa/hosted-skills/alexa-hosted-skills-session-persistence.html)

### Your own AWS Lambda function

1. Deploy the contents of `lambda/` with the production npm dependencies installed
   to a Node.js Lambda function using the `index.handler` handler. Use Node.js 22
   for the callback-based skill handler.
2. In the Lambda console, open **Configuration → Environment variables → Edit**.
   Add `HA_WEBHOOK_URL`, paste the HTTPS URL as its value and save. Limit access to
   the function configuration to trusted administrators. This setting takes
   precedence over the skill database.
3. Add an **Alexa Skills Kit** trigger restricted to this skill's ID. In the Alexa
   developer console, open **Build → Endpoint**, select **AWS Lambda ARN**, and
   save the function ARN for the applicable region. If the endpoint uses a version
   or alias, publish the configured version and point the endpoint or alias to it.

[AWS Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html) · [Connecting an Alexa skill to Lambda](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-an-aws-lambda-function.html)

## 5. Try it

1. **Test tab**: set "Skill testing is enabled in" to **Development**.
2. At the Echo Show, say **"Alexa, open office remote"**. The remote should appear.
3. Tap a button and check that the Apple TV responds.

## 6. Turn on the automatic opening

In Home Assistant, turn on the automation **Office Remote: show on Echo Show**. From then on the
remote opens when the Apple TV turns on and the Echo Show goes back to its home screen when the
Apple TV turns off.

## Changing things later

- **App buttons**: edit the `APPS` list at the top of `index.js`. Each `source` must match an app
  name Home Assistant lists for the Apple TV.
- **Revoking access**. Disable the old cloud webhook in Home Assistant, change the
  automation's webhook ID to a new long random value and reload the automation.
  Enable its new cloud webhook and copy its new URL. For Alexa-hosted, edit the
  existing item's `webhookUrl` value in the skill database. For your own Lambda,
  replace `HA_WEBHOOK_URL` and update any published version or alias in use.
  Confirm a button works with the new setting. If a URL was previously pasted
  into skill code or shared in a commit, revoke it even after removing it from
  the source.
