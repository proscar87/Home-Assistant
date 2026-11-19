# Outage Map

Uptime monitoring and outage detection for Home Assistant. Track official provider incidents, check service reachability from your home network, and trigger alerts or automations when a service goes down.

![Outage Map logo](https://raw.githubusercontent.com/yanke7/Home-Assistant/main/Outage%20Map/docs/outage-map-logo.jpg)

Open [the sample dashboard](Outage%20Map/docs/card-preview.html) in a browser to try the layout and controls with fictional data.

## Already configured? Open or create a dashboard

If **Settings → Devices & services → Outage Map** shows an Outage Map entry, setup is complete. **Close the “Outage Map is already configured” dialog and skip the install steps.** One entity is normal before adding any monitors. It's the internet connectivity sensor.

1. Open **Settings → Dashboards → Add dashboard → New dashboard from scratch**. Name it **Outage Map** and select **Create**. You can also use an existing editable dashboard.
2. Open that dashboard and refresh the browser or reopen the Home Assistant app. Select **Edit dashboard → Add card**, then search for **Outage Map** and save it.
3. Click **+ Add service inside the Outage Map card** and choose a provider. The **Add service** button on the **Devices & services** page starts integration setup again.

**Seeing “Installed version” and “Up-to-date”?** That is the HACS/Marketplace update entity. Close it. If you added an entity tile to a dashboard, replace that tile with **Add card → Manual** using the configuration below. The dashboard card is a custom card and does not require selecting an entity.

The integration doesn't create a sidebar dashboard automatically. If the card is missing from the picker, choose **Manual** and paste this into the card editor:

```yaml
type: custom:outage-watch-card
```

If it says **Custom element doesn't exist: outage-watch-card** after refreshing, add `/outage_watch/outage-watch-card.js?v=0.2.10` as a **JavaScript module** in **Settings → Dashboards → Resources** (enable **Advanced mode** in your user profile if Resources isn't visible). Reload the dashboard. If the module URL returns 404, check that the integration is loaded and restart Home Assistant once after installation.

## Install for beta testing

[![Open Outage Map in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=yanke7&repository=Home-Assistant&category=integration)

1. Click the button to open Outage Map in HACS. If the button cannot reach your instance, open **Custom repositories** in HACS and add `https://github.com/yanke7/Home-Assistant` as an **Integration**.
2. Download **Outage Map**, then restart Home Assistant.
3. In **Settings → Devices & services**, add **Outage Map** once if it isn't already listed. Then follow the dashboard steps above.

For manual installation, copy `custom_components/outage_watch` into your Home Assistant configuration directory under `custom_components/`, restart, and continue at step 3.

If you already use Outage Watch, the integration domain and card type are unchanged. Keep your existing config entry to retain settings, service IDs, and history. Back up your configuration before replacing the manually installed component with HACS files.

## Optional Speedtest graph and Run test button

The Outage Map card includes the graph and button. The measurements come from Home Assistant's separate, built-in **Speedtest.net** integration. Outage Map does not run its own speed test.

1. In **Settings → Devices & services → Add integration**, search for **Speedtest.net** and set it up. No separate HACS download is needed for Speedtest.net.
2. Once its sensors have readings, refresh your Outage Map dashboard. The header automatically shows the available readings from `sensor.speedtest_download`, `sensor.speedtest_upload`, and `sensor.speedtest_ping`. Without those sensors the Speedtest section stays hidden.
3. Administrators can select **Run test** to refresh the readings on demand. The 24-hour download and upload graph uses Home Assistant History and needs recorded sensor data.

Open **Theme → Speedtest style** to choose **Classic**, **Signal Matrix**, **Neon Gauges**, **Flux Rails**, or **Aqua Wave**. The header and history graphs follow the dashboard theme, including Follow Appearance. Classic is the default, and the choice is saved per browser. The header trends use 24 hours of history. Gauges and rails display the latest readings.

Click the graph or readings to open **Speedtest history**. Select **24 hours**, **7 days**, or **30 days** to view recorded download, upload, and ping. Home Assistant Recorder typically retains 10 days of detailed history by default. The longer view displays what is actually available and shows the oldest reading found. Hourly long-term averages are separate from this log.

If you renamed the sensors, set `speedtest_download_entity`, `speedtest_upload_entity`, and `speedtest_ping_entity` in the card YAML. The catalog's **Ookla Speedtest** tile checks whether the public website responds and is separate from the bandwidth graph.

[Home Assistant Speedtest.net setup](https://www.home-assistant.io/integrations/speedtestdotnet/)

## Theme screenshots

All six screenshots use the same fictional service and Speedtest data. **Follow Appearance** is shown with an Amethyst palette and will look different with your active Home Assistant theme.

| Brushed Steel | Amber Relay |
| --- | --- |
| [![Brushed Steel](Outage%20Map/docs/screenshots/brushed-steel.jpg)](Outage%20Map/docs/screenshots/brushed-steel.jpg) | [![Amber Relay](Outage%20Map/docs/screenshots/amber-relay.jpg)](Outage%20Map/docs/screenshots/amber-relay.jpg) |

| Neon Grid | Midnight Drift |
| --- | --- |
| [![Neon Grid](Outage%20Map/docs/screenshots/neon-grid.jpg)](Outage%20Map/docs/screenshots/neon-grid.jpg) | [![Midnight Drift](Outage%20Map/docs/screenshots/midnight-drift.jpg)](Outage%20Map/docs/screenshots/midnight-drift.jpg) |

| Aqua Current | Follow Appearance |
| --- | --- |
| [![Aqua Current](Outage%20Map/docs/screenshots/aqua-current.jpg)](Outage%20Map/docs/screenshots/aqua-current.jpg) | [![Follow Appearance shown with an Amethyst palette](Outage%20Map/docs/screenshots/follow-appearance.jpg)](Outage%20Map/docs/screenshots/follow-appearance.jpg) |

## Mobile layout screenshots

Choose **Theme → Mobile layout** to switch. **One column** is the default. Both screenshots use the same sample data at 390 px wide.

| One column | Two columns |
| --- | --- |
| [![One column on mobile](Outage%20Map/docs/screenshots/mobile-one-column.jpg)](Outage%20Map/docs/screenshots/mobile-one-column.jpg) | [![Two columns on mobile](Outage%20Map/docs/screenshots/mobile-two-columns.jpg)](Outage%20Map/docs/screenshots/mobile-two-columns.jpg) |

## Catalog coverage

Use the category buttons above the dashboard tiles to focus on one group of tracked services. **All** restores the full list. The overall status counts and outage banners continue to cover every tracked service.

Use **+ Add service** and filter by **AI**, **Video**, **Audio**, **Smart home**, **Weather**, or **Online services**. Catalog entries only start polling when you choose to track them. See the [endpoint verification results](Outage%20Map/docs/catalog-expansion.md) for the expanded catalog and its signal types.

For a specific camera, plug, bridge, or thermostat, use a Home Assistant automation based on the device entity becoming `unavailable`. Provider tiles monitor shared cloud services or public endpoints.

## How does Outage Map compare with Downdetector?

Downdetector shows spikes in user reports. Outage Map combines official provider incident feeds, where available, with reachability checks from your Home Assistant instance. You can use its service status entities to send notifications or trigger automations when a service has a problem.

## What the dashboard reports

- **Feed + checks** combines a provider's public status feed and endpoint reachability. **Feed only** uses the provider's feed. **Checks only** tests a particular URL, so a successful request can miss an incident elsewhere in the service.
- With no tracked services, connectivity checks pause. With services tracked, Outage Map checks a primary connectivity endpoint and uses a fallback if the first is unavailable. Each installation schedules service checks at its own offsets. A provider can delay its next check using the Retry-After header. Repeated feed errors also increase the time between feed requests.
- Confirmed provider incidents and failures observed only from your Home Assistant are identified separately. When both connectivity checks repeatedly fail, service states become unknown and notifications pause.
- When alert delivery fails, that service waits 30 seconds before trying again. Each failure doubles the wait up to 15 minutes. A retry runs at the next monitoring evaluation after its deadline and only while the alert is still applicable. Disabling alerts clears the delivery state. On reload, successful outage deliveries are remembered for recovery notifications, while retry delays start fresh after current evidence is available.
- Latency charts and baselines use up to 24 hours of history stored locally. Gaps indicate missing or unsuccessful checks. Third parties receive normal HTTP requests from your Home Assistant. There is no telemetry.
- The initial catalog includes Statuspage feeds and public URL checks. A site may block automated checks from your network. The Apple iCloud catalog entry pairs an iCloud.com check with Apple System Status. An existing iCloud.com monitor is upgraded in place. It follows Apple's iCloud components and ignores resolved incidents and unrelated Apple services.
- The Google catalog entry combines a Google homepage check with the official Google Workspace incident feed. The feed covers Workspace products such as Gmail, Drive, and Calendar. Spotify and eWeLink monitor public web endpoints. Spotify also links to its official issue tracker.

For each service, use the status and problem entities in automations. URL checks also create a response-time sensor. Notifications are off by default.

## Appearance and mobile layout

Use **Theme** to pick a style or follow the current Appearance palette. The selection is stored in each browser. Under **Theme → Mobile layout**, choose **One column** for larger tiles or **Two columns** for a compact grid. This setting is saved per browser and only applies to narrow dashboard views. **Follow Appearance** uses the optional Yanke Appearance resource when available and native Home Assistant theme colors otherwise.


Please report reproducible beta issues on [GitHub](https://github.com/yanke7/Home-Assistant/issues). Include your Home Assistant version and the relevant error or steps to reproduce. Remove tokens, addresses, and personal data from logs or screenshots.

## Optional server info

Open **Theme → Server info → Show server info**. This is off by default and is saved per browser. The panel shows Home Assistant's version and the available CPU, memory, disk, temperature, and host uptime readings from [System Monitor](https://www.home-assistant.io/integrations/systemmonitor/). Enable only the System Monitor sensors you want to display. No extra checks run when the panel is open.

For renamed or alternative sensors, add a `server_info_entities` mapping to the card YAML. Supported keys are `cpu`, `memory`, `disk`, `disk_free`, `temperature`, and `uptime`. CPU, memory, and disk usage should be percentage sensors. Host uptime expects a timestamp for the host's last boot. The disk sensors display the mount point selected in System Monitor.

## History and storage

Outage Map keeps a rolling 24-hour window of up to 1,440 check samples per monitored service for the dashboard. Old samples are dropped as checks are saved. Provider feeds are cached as their latest result.

Home Assistant Recorder can still record outage and recovery states and live response-time sensor changes under its normal retention rules. **Keep long-term latency statistics** is off by default. Enable it under **Settings → Devices & services → Outage Map → Configure** if you want Recorder to generate hourly response-time statistics. Disabling it stops future hourly aggregation and keeps existing data. The dashboard's own 24-hour charts work either way.

The sample cap applies to Outage Map's own store. Recorder is shared with other integrations and is subject to its own purge and repack settings. Speedtest history is recorded separately by Home Assistant.

[Other Home Assistant projects](Other%20Home%20Assistant%20Projects/)
