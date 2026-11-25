import unittest
from datetime import datetime, timezone
from unittest.mock import patch
import national_alerts as alerts

NOW = datetime(2026, 11, 25, tzinfo=timezone.utc)


class NationalAlertTests(unittest.TestCase):
    def setUp(self):
        alerts._cache.clear()
        alerts._retry.clear()

    def test_england_current_and_cancelled(self):
        row = {"floodAreaID": "fixture", "description": "Fixture river",
               "severityLevel": 2, "timeRaised": "2026-11-24T12:00:00Z"}
        rows = alerts.parse_alerts("england", {"items": [row, {**row, "severityLevel": 4}]}, NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["severity"], "Flood Warning")
        self.assertEqual(rows[0]["time_basis"], "Source warning time")

    def test_live_format_without_timezone(self):
        rows = alerts.parse_alerts("england", {"items": [{"floodAreaID": "fixture",
            "description": "Fixture coast", "severityLevel": 3, "timeRaised": "2026-11-25T08:43:21"}]}, NOW)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["time_utc"])
        self.assertEqual(rows[0]["source_time"], "2026-11-25T08:43:21")

    def test_us_actual_unexpired_only(self):
        row = {"status": "Actual", "messageType": "Alert", "id": "urn:oid:fixture",
               "event": "Winter Storm Warning", "areaDesc": "Fixture county",
               "severity": "Severe", "sent": "2026-11-24T12:00:00Z",
               "expires": "2026-11-26T12:00:00Z"}
        features = [{"properties": item} for item in [
            row, {**row, "status": "Test"}, {**row, "messageType": "Cancel"},
            {**row, "expires": "2026-11-24T13:00:00Z"}]]
        rows = alerts.parse_alerts("us", {"features": features}, NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["severity"], "Severe")

    def test_invalid_and_empty(self):
        with self.assertRaises(ValueError):
            alerts.parse_alerts("england", {"items": [{"unexpected": True}]})
        self.assertEqual(alerts.parse_alerts("england", {"items": []}), [])
        with self.assertRaises(ValueError):
            alerts.parse_alerts("england", {"items": [{"severityLevel": 3}]})
        with self.assertRaises(ValueError):
            alerts.parse_alerts("us", {"features": [{"properties": {"status": "Actual", "messageType": "Alert"}}]})

    def test_outage_and_cache(self):
        with patch.object(alerts, "download", side_effect=OSError):
            result = alerts.alerts("england")
            self.assertEqual(result["status"], "unavailable")
            self.assertIsNone(result["checked_at_utc"])
        alerts._retry.clear()
        with patch.object(alerts, "download", return_value={"items": []}) as download:
            self.assertEqual(alerts.alerts("england")["status"], "available")
            self.assertEqual(alerts.alerts("england")["returned_count"], 0)
            download.assert_called_once()
        alerts._cache["england"] = (alerts.monotonic()-301, "2026-11-25T00:00:00Z", [])
        with patch.object(alerts, "download", side_effect=OSError):
            self.assertEqual(alerts.alerts("england")["status"], "stale")
