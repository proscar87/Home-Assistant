from importlib import import_module
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, Mock, patch

package = ModuleType("chart_history_component")
package.__path__ = [str(Path(__file__).parents[1] / "custom_components/outage_watch")]
framework = {name: MagicMock() for name in (
    "homeassistant.helpers", "homeassistant.helpers.dispatcher", "homeassistant.helpers.storage",
    "aiohttp", "aiohttp.abc", "yarl",
)}
framework["aiohttp.abc"].AbstractResolver = object
framework["aiohttp"].ClientError = OSError
with patch.dict(sys.modules, {package.__name__: package, **framework}):
    monitor = import_module(package.__name__ + ".monitor")


class MonitorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        entry = SimpleNamespace(entry_id="home-a", options={"scan_interval": 60})
        self.instance = monitor.Monitor(Mock(), entry, [])
        self.instance.control = True

    async def test_saved_chart_history_retains_observation_cadence(self):
        m = self.instance
        now = monitor.time()
        samples = [[now - 2, "ok", 15], [now - 1, "ok", 18, 120]]
        m.store.async_load = AsyncMock(return_value={"services": {"a": {"id": "a", "samples": samples}}})
        await m.load()
        self.assertEqual(m.services["a"]["samples"], [[now - 2, "ok", 15, 60], [now - 1, "ok", 18, 120]])
