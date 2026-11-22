import unittest
from copy import deepcopy
from unittest.mock import patch

from fastapi.testclient import TestClient

import earthquakes as usgs
from main import app

NOW = 1_795_171_514_000
EVENT = {
    'id': 'test-event',
    'geometry': {'type': 'Point', 'coordinates': [-12, 8, 10]},
    'properties': {'type': 'earthquake', 'mag': 5.1, 'time': NOW - 120_000, 'place': 'Test location'},
}


class EarthquakeTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.multiple('earthquakes', _snapshot=None, _retry_at=0, _unavailable=False))
        self.enterContext(patch('earthquakes.time', return_value=NOW / 1000))
        self.client = TestClient(app)

    def test_feed_uses_source_coordinates_and_filters_invalid_events(self):
        invalid = deepcopy(EVENT)
        invalid['geometry']['coordinates'] = [-12, 91]
        old = deepcopy(EVENT)
        old['properties']['time'] = NOW - 8 * usgs.DAY_MS
        other = deepcopy(EVENT)
        other['properties']['type'] = 'explosion'
        payload = {'type': 'FeatureCollection', 'metadata': {'generated': NOW},
                   'features': [EVENT, invalid, old, other, EVENT]}
        feed = usgs._parse_feed(payload, NOW)
        self.assertEqual(len(feed['events']), 1)
        event = feed['events'][0]
        self.assertEqual((event['longitude'], event['latitude']), (-12, 8))
        self.assertEqual(event['occurred_at_ms'], NOW - 120_000)
        self.assertEqual(event['url'], 'https://earthquake.usgs.gov/earthquakes/eventpage/test-event')

    def test_api_caches_success_and_preserves_snapshot_on_outage(self):
        snapshot = {'generated_at_ms': NOW, 'events': []}
        with patch('earthquakes._fetch_feed', side_effect=[snapshot, TimeoutError()]) as fetch:
            first = self.client.get('/api/earthquakes')
            self.assertEqual(first.status_code, 200)
            self.assertFalse(first.json()['stale'])
            self.assertEqual(first.headers['cache-control'], 'no-store')
            self.assertEqual(self.client.get('/api/earthquakes').json(), first.json())
            fetch.assert_called_once()
            with patch('earthquakes._retry_at', 0):
                stale = self.client.get('/api/earthquakes').json()
                self.assertEqual(stale, {**snapshot, 'stale': True})

    def test_initial_outage_returns_unavailable_and_backs_off(self):
        with patch('earthquakes._fetch_feed', side_effect=TimeoutError()) as fetch:
            for _ in range(2):
                result = self.client.get('/api/earthquakes')
                self.assertEqual(result.status_code, 503)
                self.assertEqual(result.headers['retry-after'], '30')
            fetch.assert_called_once()

    def test_provider_retry_after_is_honoured(self):
        from urllib.error import HTTPError
        error = HTTPError('https://example.invalid/feed', 429, 'rate limited',
                          {'Retry-After': '180'}, None)
        with (patch('earthquakes.monotonic', return_value=100),
              patch('earthquakes._fetch_feed', side_effect=error) as fetch):
            for _ in range(2):
                response = self.client.get('/api/earthquakes')
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.headers['retry-after'], '180')
            fetch.assert_called_once()
