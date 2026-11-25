"""Set up the Home Assistant providers used by the dashboard readouts."""

from homeassistant.config_entries import SOURCE_USER
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import slugify

SENSORS = {
    "speedtestdotnet": {key: key for key in ("download", "upload", "ping")},
    "systemmonitor": {
        "cpu": slugify("processor_use_"),
        "memory": slugify("memory_use_percent_"),
        "disk": slugify("disk_use_percent_/"),
        "disk_free": slugify("disk_free_/"),
        "temperature": slugify("processor_temperature_"),
        "uptime": slugify("last_boot_"),
    },
}


def entity_ids(hass, provider):
    registry = er.async_get(hass)
    return {
        key: entity_id
        for key, unique_id in SENSORS[provider].items()
        if (entity_id := registry.async_get_entity_id("sensor", provider, unique_id))
    }


async def async_enable_readouts(hass, provider):
    entries = hass.config_entries.async_entries(provider)
    if not entries:
        flow = hass.config_entries.flow
        result = await flow.async_init(provider, context={"source": SOURCE_USER})
        if result["type"] == FlowResultType.FORM and result.get("step_id") == "user":
            result = await flow.async_configure(result["flow_id"], {})
        if result["type"] != FlowResultType.CREATE_ENTRY:
            if result["type"] == FlowResultType.FORM:
                flow.async_abort(result["flow_id"])
            raise HomeAssistantError("Home Assistant could not set up the readout provider")
        entries = [result["result"]]

    if provider != "systemmonitor":
        return
    registry = er.async_get(hass)
    changed_entries = set()
    for entity_id in entity_ids(hass, provider).values():
        entity = registry.async_get(entity_id)
        if entity and entity.disabled_by == er.RegistryEntryDisabler.INTEGRATION:
            registry.async_update_entity(entity_id, disabled_by=None)
            changed_entries.add(entity.config_entry_id)
    for entry in entries:
        if entry.entry_id in changed_entries:
            await hass.config_entries.async_reload(entry.entry_id)
