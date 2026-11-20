"""Exercise alert delivery and entity updates using simulated time and local listeners."""
import asyncio
from importlib import import_module
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, Mock, patch

# The repository checks run with the standard library. Isolate the integration's
# external imports so these tests can exercise its scheduler without starting HA.
package = ModuleType("alert_test_component")
package.__path__ = [str(Path(__file__).parents[1] / "custom_components/outage_watch")]
framework = {name: MagicMock() for name in (
    "homeassistant.helpers", "homeassistant.helpers.dispatcher", "homeassistant.helpers.storage",
    "aiohttp", "aiohttp.abc", "yarl",
)}
framework["aiohttp.abc"].AbstractResolver = object
framework["aiohttp"].ClientError = OSError
with patch.dict(sys.modules, {package.__name__: package, **framework}):
    entity = import_module(package.__name__ + ".entity")
    monitor = import_module(package.__name__ + ".monitor")


class StopClock(Exception):
    """End a simulated watch loop."""


class MonitorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        entry = SimpleNamespace(entry_id="home-a", options={"scan_interval": 60})
        self.instance = monitor.Monitor(Mock(), entry, [])
        self.instance.control = True

    async def test_paused_endpoint_keeps_polling_provider(self):
        m = self.instance
        item = {"id": "example", "name": "Example", "url": "https://example.org",
                "feed": "https://status.example.org", "paused": True, "samples": []}
        feed = AsyncMock(return_value=({"data": {"level": "major"}}, 0))
        with patch.object(monitor, "feed_update", feed), patch.object(monitor, "probe", AsyncMock()) as probe, \
             patch.object(monitor, "next_slot", return_value=0), \
             patch.object(monitor.asyncio, "sleep", AsyncMock(side_effect=StopClock)):
            with self.assertRaises(StopClock):
                await m.watch(item)
            feed.assert_awaited_once()
            probe.assert_not_awaited()
            self.assertEqual(m.state(item)["status"], "outage")
            item["paused"] = False
            probe.return_value = ("ok", 20, 200, 0)
            with self.assertRaises(StopClock):
                await m.watch(item)
            probe.assert_awaited_once()

    async def test_delivery_backoff_recovery_and_service_isolation(self):
        m = self.instance
        m.notify_action = "notify.phone"
        a = {"id": "a", "name": "A", "alerts": True}
        b = {"id": "b", "name": "B", "alerts": True}
        deliver = m.hass.services.async_call = AsyncMock(side_effect=OSError)
        clock = 0
        with patch.object(monitor, "monotonic", lambda: clock), patch.object(monitor.LOGGER, "exception"):
            for clock in [0, 10, 29]:
                await m.notify(a, "outage")
            self.assertEqual(deliver.await_count, 1)
            await m.notify(b, "outage")
            self.assertEqual(deliver.await_count, 2)
            await m.notify(b, "operational")
            self.assertNotIn("b", m.pending_alerts)
            for clock, delay in [(30, 60), (90, 120), (210, 240), (450, 480), (930, 900), (1830, 900)]:
                await m.notify(a, "outage")
                self.assertEqual(m.pending_alerts["a"].retry_at, clock + delay)
            deliver.side_effect = None
            clock = 2730
            await m.notify(a, "outage")
            await m.notify(a, "outage")
            self.assertTrue(a["alert_open"])
            await m.notify(a, "operational")
            self.assertFalse(a["alert_open"])
            self.assertEqual(deliver.await_count, 10)
            self.assertEqual(deliver.await_args.args[2]["message"], "A recovered.")

    async def test_disabled_or_removed_services_discard_pending_deliveries(self):
        m = self.instance
        m.notify_action = "notify.phone"
        a = {"id": "a", "name": "A", "alerts": True}
        m.services["a"] = a
        m.tasks["a"] = asyncio.create_task(asyncio.sleep(3600))
        deliver = m.hass.services.async_call = AsyncMock(side_effect=OSError)
        with patch.object(monitor.LOGGER, "exception"):
            await m.notify(a, "outage")
            m.set_alerts(a, False)
            await m.notify(a, "outage")
            self.assertEqual(deliver.await_count, 1)
            self.assertNotIn("a", m.pending_alerts)
            m.set_alerts(a, True)
            await m.notify(a, "outage")
            self.assertEqual(deliver.await_count, 2)
            await m.remove("a")
            self.assertNotIn("a", m.pending_alerts)
            self.assertNotIn("a", m.entity_states)

    async def test_reload_remembers_delivered_outage_without_old_retry_tasks(self):
        m = self.instance
        m.notify_action = "notify.phone"
        a = {"id": "a", "name": "A", "alerts": True, "alert_open": True}
        m.store.async_load = AsyncMock(return_value={"services": {"a": a}})
        await m.load()
        deliver = m.hass.services.async_call = AsyncMock()
        await m.notify(a, "outage")
        deliver.assert_not_awaited()
        await m.notify(a, "operational")
        self.assertEqual(deliver.await_args.args[2]["message"], "A recovered.")

    async def test_targeted_listeners_freshness_and_connectivity(self):
        m = self.instance
        clock = 1000
        svc = {"id": "a", "samples": [[clock, "ok", 23]], "url": "url"}
        other = {"id": "b", "samples": [], "feed": "feed",
                 "provider": {"checked": clock, "data": {"level": "major"}}}
        m.services.update(a=svc, b=other)
        listeners = {}

        def connect(hass, signal, listener):
            listeners.setdefault(signal, []).append(listener)
            return lambda: listeners[signal].remove(listener)

        def send(hass, signal):
            for listener in listeners.get(signal, []):
                listener()

        class Base:
            async def async_added_to_hass(self):
                pass

        class Listener(entity.WatchEntity, Base):
            def __init__(self, service_id, kind):
                super().__init__(m, service_id, kind, kind)
                self.hass = m.hass
                self.values = []
                self.async_on_remove = Mock()

            def async_write_ha_state(self):
                self.values.append(m.control if self.signal == m.change else self.info["status"])

        a, b, internet = Listener("a", "status"), Listener("b", "status"), Listener("internet", "connectivity")
        with (patch.object(entity, "async_dispatcher_connect", connect),
              patch.object(monitor, "async_dispatcher_send", send), patch.object(monitor, "time", lambda: clock)):
            for item in (a, b, internet):
                await item.async_added_to_hass()
            for service in (svc, other):
                m.entity_states[service["id"]] = m.state(service)
            svc["samples"].append([clock + 1, "ok", 11])
            clock += 1
            m.publish_state(svc)
            m.publish_state(svc)
            self.assertEqual([len(i.values) for i in (a,b,internet)], [1,0,0])

            async def sleep(delay):
                nonlocal clock
                clock += delay
                if clock > 1320:
                    raise StopClock

            with patch.object(monitor.asyncio, "sleep", sleep), self.assertRaises(StopClock):
                m.failures = 1  # Connectivity is uncertain; no new probes should refresh the sample.
                await m.watch(svc)
            self.assertEqual(a.values, ["operational", "unknown"])
            m.publish_state(other)
            self.assertEqual(b.values, ["unknown"])
            m.failures = 0
            sleeps = 0

            async def rounds(_):
                nonlocal sleeps
                sleeps += 1
                if sleeps == 3:  # Initial phase delay, then two failed rounds.
                    raise StopClock

            with (patch.object(monitor, "probe", AsyncMock(return_value=("failed", None, 500, 0))),
                  patch.object(monitor.asyncio, "sleep", rounds), self.assertRaises(StopClock)):
                await m.watch_connection()
            self.assertEqual(internet.values, [False])
            self.assertEqual([len(i.values) for i in (a,b)], [3,2])
            a.async_on_remove.call_args.args[0]()
            send(m.hass, m.service_change("a"))
            self.assertEqual(len(a.values), 3)
