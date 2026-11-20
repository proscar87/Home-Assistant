from importlib import import_module
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch

package = ModuleType("dashboard_permissions_component")
package.__path__ = [str(Path(__file__).parents[1] / "custom_components/outage_watch")]
framework = {name: MagicMock() for name in (
    "homeassistant.helpers", "homeassistant.helpers.dispatcher", "homeassistant.helpers.storage",
    "aiohttp", "aiohttp.abc", "yarl",
)}
framework["aiohttp.abc"].AbstractResolver = object
framework["aiohttp"].ClientError = OSError
with patch.dict(sys.modules, {package.__name__: package, **framework}):
    monitor = import_module(package.__name__ + ".monitor")


class DashboardPermissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_websocket_filters_each_reader(self):
        from importlib.util import module_from_spec, spec_from_file_location

        deps = {name: MagicMock() for name in (
            "voluptuous", "homeassistant.components", "homeassistant.components.http",
            "homeassistant.exceptions", "homeassistant.helpers.service",
            "homeassistant.auth.permissions.const",
        )}
        deps["homeassistant.auth.permissions.const"].POLICY_READ = "read"
        readouts = Mock()
        readouts.SENSORS = {"speedtestdotnet": {}}
        readouts.entity_ids.return_value = {"download": "sensor.renamed_download"}
        deps[package.__name__ + ".readouts"] = readouts
        ws = deps["homeassistant.components"].websocket_api
        ws.websocket_command.side_effect = lambda schema: lambda fn: fn
        ws.async_response.side_effect = lambda fn: fn
        spec = spec_from_file_location(package.__name__ + ".entrypoint", Path(package.__path__[0]) / "__init__.py",
                                       submodule_search_locations=None)
        api = module_from_spec(spec)
        api.__package__ = package.__name__
        with patch.dict(sys.modules, {package.__name__: package, **framework, **deps}):
            spec.loader.exec_module(api)

        hass = Mock()
        hass.config_entries.async_entries.return_value = []
        instance = monitor.Monitor(hass, SimpleNamespace(entry_id="home", options={}), [])
        instance.control = False
        instance.notify_action = "notify.phone"
        instance.catalog = {"other": {"id": "other", "name": "Other", "category": "Cloud"}}
        for key in ("first", "hidden", "missing"):
            instance.services[key] = {"id": key, "name": key, "samples": [[monitor.time(), "ok", 42]], "alerts": True}
        hass.config_entries.async_loaded_entries.return_value = [SimpleNamespace(runtime_data=instance)]
        mapping = {instance.unique(key, kind): f"sensor.renamed_{key}_{kind}"
                   for key in ("first", "hidden") for kind in ("status", "response_time")}
        mapping[instance.unique("internet", "connectivity")] = "binary_sensor.internet"
        api.er.async_get.return_value.async_get_entity_id.side_effect = lambda domain, platform, uid: mapping.get(uid)
        for admin, allowed, expected in [
            (True, set(), ["first", "hidden", "missing"]),
            (False, set(mapping.values()), ["first", "hidden"]),
            (False, {"sensor.renamed_first_status"}, ["first"]),
            (False, {"sensor.renamed_hidden_response_time"}, []),
        ]:
            connection = Mock()
            connection.user.is_admin = admin
            connection.user.permissions.check_entity.side_effect = lambda entity_id, policy: (admin or entity_id in allowed) and policy == "read"
            await api.dashboard(hass, connection, {"id": 13})
            call_id, result = connection.send_result.call_args.args
            self.assertEqual(call_id, 13)
            self.assertEqual([item["id"] for item in result["services"]], expected)
            self.assertEqual(result["can_manage"], admin)
            self.assertEqual(
                result["readout_entities"]["speedtestdotnet"],
                {"download": "sensor.renamed_download"} if admin else {},
            )
            self.assertEqual("connected" in result, admin or "binary_sensor.internet" in allowed)
            self.assertEqual("notify_configured" in result, admin)
            self.assertEqual("catalog" in result, admin)
            if admin:
                self.assertEqual(result["catalog"][0]["category"], "Cloud")
            for item in result["services"]:
                self.assertEqual(item["category"], "Custom")
                self.assertEqual("alerts" in item, admin)
                self.assertEqual(item["reason"] == "internet_down", "connected" in result)
                latency_allowed = admin or f"sensor.renamed_{item['id']}_response_time" in allowed
                for field in ("history", "latency", "baseline"):
                    self.assertEqual(field in item, latency_allowed)
