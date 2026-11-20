import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app
import wildfires

NOW = int(datetime(2026, 11, 20, 12, tzinfo=timezone.utc).timestamp() * 1000)


def point(date, lon, lat):
    return {'type': 'Point', 'date': date, 'coordinates': [lon, lat]}


EVENT = {
    'id': 'EONET_123', 'title': 'Example fire', 'closed': '2026-11-20T11:00:00Z',
    'categories': [{'id': 'wildfires'}],
    'geometry': [point('2026-11-19T10:00:00Z', 7, 4), point('2026-11-20T10:00:00Z', 8, 5)],
    'sources': [{'id': 'GDACS', 'url': 'https://www.gdacs.org/report.aspx?eventtype=WF&eventid=123'}],
}


class WildfireTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.multiple('wildfires', _snapshot=None, _retry_at=0, _unavailable=False))
        self.enterContext(patch('wildfires.time', return_value=NOW / 1000))
        self.client = TestClient(app)

    def test_last_valid_observation_and_original_source(self):
        future = point('2026-11-21T00:00:00Z', 80, 1)
        invalid = point('2026-11-20T11:00:00Z', 80, 99)
        raw = {**EVENT, 'geometry': [*EVENT['geometry'], future, invalid]}
        result = wildfires._parse_feed({'events': [raw]}, NOW)
        event = result['events'][0]
        self.assertEqual((event['longitude'], event['latitude']), (8, 5))
        self.assertEqual(event['observed_at_ms'], NOW - 2 * 3600 * 1000)
        self.assertEqual(event['url'], EVENT['sources'][0]['url'])
        self.assertEqual(event['source'], 'GDACS')
        self.assertTrue(event['closed'])

    def test_polygons_old_observations_and_unsafe_links(self):
        polygon = {**EVENT, 'id': 'EONET_124', 'geometry': [{'type': 'Polygon', 'coordinates': []}]}
        old = {**EVENT, 'id': 'EONET_125', 'geometry': [point('2026-11-12T10:00:00Z', 7, 4)]}
        missing_source = {**EVENT, 'sources': [{'url': 'javascript:alert(1)'}, {'url': 'https://name@example.com'}]}
        result = wildfires._parse_feed({'events': [polygon, old, missing_source]}, NOW)
        self.assertEqual(len(result['events']), 1)
        self.assertEqual(result['events'][0]['url'], 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_123')

    def test_cached_feed_marks_outage_stale_and_keeps_old_snapshot(self):
        snapshot = wildfires._parse_feed({'events': [EVENT]}, NOW)
        with patch('wildfires._fetch_feed', side_effect=[snapshot, TimeoutError()]) as fetch:
            first = self.client.get('/api/wildfires')
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.headers['cache-control'], 'no-store')
            self.assertEqual(first.json(), {**snapshot, 'stale': False})
            self.assertEqual(self.client.get('/api/wildfires').json(), first.json())
            fetch.assert_called_once()
            with patch('wildfires._retry_at', 0):
                self.assertEqual(self.client.get('/api/wildfires').json(), {**snapshot, 'stale': True})

    def test_initial_outage_is_reported_with_backoff(self):
        with patch('wildfires._fetch_feed', side_effect=TimeoutError()) as fetch:
            for _ in range(2):
                response = self.client.get('/api/wildfires')
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.headers['retry-after'], '30')
            fetch.assert_called_once()
