import unittest
from unittest.mock import patch
import intelligence_feeds as f
from fastapi import HTTPException

ATOM = b"""<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Travel advice update</title><updated>2026-11-24T08:00:00Z</updated><link rel="alternate" href="https://www.gov.uk/foreign-travel-advice/france"/></entry><entry><title>Unsafe</title><updated>2026-11-24T08:00:00Z</updated><link href="https://evil.example/"/></entry></feed>"""
RSS = b"""<rss version="2.0"><channel><item><title>Press release</title><link>https://www.ecb.europa.eu/press/example</link><pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>"""

class DedicatedFeedTests(unittest.TestCase):
    def setUp(self):
        f._cache.clear()
        f._retry.clear()

    def tearDown(self):
        f._cache.clear()
        f._retry.clear()

    def test_atom_source_allowlist(self):
        rows = f.parse_feed(ATOM, {"www.gov.uk"})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "Travel advice update")

    def test_rss(self):
        rows = f.parse_feed(RSS, {"www.ecb.europa.eu"})
        self.assertEqual(rows[0]["published_at_utc"], "2026-11-24T08:00:00+00:00")

    def test_reject_entities(self):
        with self.assertRaises(ValueError):
            f.parse_feed(b'<!DOCTYPE rss><rss/>', set())

    def test_cache_and_backoff(self):
        with patch.object(f, "_download", return_value=ATOM) as request:
            self.assertEqual(f.feed("travel")["status"], "available")
            self.assertEqual(len(f.feed("travel")["reports"]), 1)
            request.assert_called_once()
        with patch.object(f, "_download", side_effect=OSError) as request:
            self.assertEqual(f.feed("cyber")["status"], "unavailable")
            self.assertEqual(f.feed("cyber")["status"], "unavailable")
            request.assert_called_once()

    def test_no_arbitrary_categories(self):
        with self.assertRaises(HTTPException):
            f.feed("https://example.com")

    def test_gdacs_legacy_links_are_upgraded(self):
        xml = b"""<rss><channel><item><title>Disaster alert</title><link>http://www.gdacs.org/report.aspx?eventtype=FL&amp;eventid=123</link><pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>"""
        rows = f.parse_feed(xml, {"www.gdacs.org", "gdacs.org"})
        self.assertEqual(rows[0]["url"], "https://www.gdacs.org/report.aspx?eventtype=FL&eventid=123")

    def test_iaea_publications_upgrade_official_links_only(self):
        xml = b"""<rss><channel>
        <item><title>Science programme publication</title><link>http://www.iaea.org/newscenter/news/fixture</link><pubDate>Mon, 23 Nov 26 09:00:00 +0100</pubDate></item>
        <item><title>Other site</title><link>http://example.com/fixture</link><pubDate>Mon, 23 Nov 26 09:00:00 +0100</pubDate></item>
        </channel></rss>"""
        self.assertNotIn("iaea", f.PULSE_CATEGORIES)
        with patch.object(f, "_download", return_value=xml) as request:
            result = f.feed("iaea")
        request.assert_called_once_with("https://www.iaea.org/feeds/news")
        self.assertEqual(result["status"], "available")
        self.assertEqual(result["reports"], [{
            "title": "Science programme publication",
            "url": "https://www.iaea.org/newscenter/news/fixture",
            "published_at_utc": "2026-11-23T08:00:00+00:00",
        }])

    def test_weather_feed_preserves_distinct_warnings_and_original_titles(self):
        xml = b"""<rss><channel>
        <item><title>Yellow warning  for rain</title><link>https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings</link><pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate></item>
        <item><title>Yellow warning for wind</title><link>https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings</link><pubDate>Tue, 24 Nov 2026 09:00:00 GMT</pubDate></item>
        </channel></rss>"""
        self.assertNotIn("weather-uk", f.PULSE_CATEGORIES)
        with patch.object(f, "_download", return_value=xml):
            result = f.feed("weather-uk")
        self.assertEqual(result["status"], "available")
        self.assertEqual([row["title"] for row in result["reports"]],
                         ["Yellow warning for wind", "Yellow warning  for rain"])
        self.assertTrue(all(row["url"] == "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings"
                            for row in result["reports"]))

    def test_rejected_items_not_reported_as_empty_success(self):
        xml = b"""<rss><channel><item><title>Invalid link</title><link>http://example.org/report</link><pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>"""
        with self.assertRaises(ValueError):
            f.parse_feed(xml, {"www.gdacs.org"})
        self.assertEqual(f.parse_feed(b"<rss><channel/></rss>", {"www.gdacs.org"}), [])

    def test_pulse_shares_source_cache(self):
        with patch.object(f, "_download", return_value=b"<rss><channel/></rss>") as request:
            result = f.pulse()
            self.assertEqual(result["status"], "checked")
            self.assertEqual(set(result["feeds"]), set(f.PULSE_CATEGORIES))
            self.assertTrue(all(row["status"] == "available" for row in result["feeds"].values()))
            f.pulse()
            self.assertEqual(request.call_count, len(f.PULSE_CATEGORIES))
            self.assertNotIn('sanctions', f._cache)
            self.assertEqual(f.feed('sanctions')['status'], 'available')
            self.assertEqual(request.call_count, len(f.PULSE_CATEGORIES)+1)

    def test_pulse_does_not_start_overlapping_aggregate(self):
        with f._pulse_lock:
            self.assertEqual(f.pulse(), {"status": "checking", "feeds": {}})

    def test_incident_alerts_use_explicit_provider_levels_only(self):
        xml = b"""<rss xmlns:gdacs="http://www.gdacs.org" xmlns:georss="http://www.georss.org/georss"><channel>
        <item><title>Flood notification</title><link>https://www.gdacs.org/report.aspx?eventid=1</link><pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate><gdacs:alertlevel>Orange</gdacs:alertlevel><gdacs:eventtype>FL</gdacs:eventtype><gdacs:country>France</gdacs:country><georss:point>46 2</georss:point></item>
        <item><title>Red in headline alone</title><link>https://www.gdacs.org/report.aspx?eventid=2</link><pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate></item>
        </channel></rss>"""
        with patch.object(f, "_download", return_value=xml) as request:
            result = f.incident_alerts()
            self.assertEqual(result["status"], "available")
            self.assertEqual(len(result["events"]), 1)
            self.assertEqual(result["events"][0]["severity"], "amber")
            self.assertEqual(result["events"][0]["country"], "France")
            f.feed("humanitarian")
            request.assert_called_once()

    def test_incident_alerts_unavailable_not_successful_empty_feed(self):
        with patch.object(f, "_download", side_effect=OSError):
            result = f.incident_alerts()
            self.assertEqual(result["status"], "unavailable")
            self.assertIsNone(result["checked_at_ms"])

    def test_concurrent_initial_gdacs_check_is_not_an_outage(self):
        with f._locks["humanitarian"]:
            with patch.object(f, "_download") as request:
                result = f.incident_alerts()
                self.assertEqual(result["status"], "checking")
                self.assertIsNone(result["checked_at_ms"])
                request.assert_not_called()
