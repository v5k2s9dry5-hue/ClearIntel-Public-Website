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

    def test_rejected_items_not_reported_as_empty_success(self):
        xml = b"""<rss><channel><item><title>Invalid link</title><link>http://example.org/report</link><pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>"""
        with self.assertRaises(ValueError):
            f.parse_feed(xml, {"www.gdacs.org"})
        self.assertEqual(f.parse_feed(b"<rss><channel/></rss>", {"www.gdacs.org"}), [])

    def test_pulse_shares_source_cache(self):
        with patch.object(f, "_download", return_value=b"<rss><channel/></rss>") as request:
            result = f.pulse()
            self.assertEqual(result["status"], "checked")
            self.assertEqual(set(result["feeds"]), set(f.SOURCES))
            self.assertTrue(all(row["status"] == "available" for row in result["feeds"].values()))
            f.pulse()
            self.assertEqual(request.call_count, len(f.SOURCES))

    def test_pulse_does_not_start_overlapping_aggregate(self):
        with f._pulse_lock:
            self.assertEqual(f.pulse(), {"status": "checking", "feeds": {}})
