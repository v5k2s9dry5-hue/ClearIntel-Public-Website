import unittest
import re
from hashlib import sha256
from collections import OrderedDict, deque
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from fastapi.testclient import TestClient
from unittest.mock import patch
from main import app
from country_news import COUNTRIES

SEARCH_RESPONSE = {'results': [], 'sources_checked': ['test'], 'provider_errors': []}

class PublicSiteTests(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(app, client=('93.184.216.34', 50000))
        self.enterContext(patch.multiple(
            'main', _rate={}, _site_searches=deque(), _search_cache=OrderedDict(),
            _active_searches=0, _next_rate_cleanup=0,
        ))

    def test_home_and_health(self):
        self.assertEqual(self.client.get('/').status_code,200)
        self.assertIn('ClearIntel',self.client.get('/').text)
        self.assertEqual(self.client.get('/health').json()['status'],'ok')

    def test_official_ukmto_source_hub_is_explicitly_external(self):
        html = self.client.get('/').text
        for path in ('/ukmto-products/warnings', '/ukmto-products/advisories',
                     '/recent-incidents', '/ukmto-products/weekly-reports'):
            self.assertIn('href="https://www.ukmto.org' + path + '"', html)
        self.assertIn('does not automatically import UKMTO reports', html)
        self.assertIn('not affiliated with or endorsed by UKMTO', html)

    def test_page_assets_are_content_versioned_and_cacheable(self):
        for path in ("/", "/countries", "/countries/gb"):
            page = self.client.get(path)
            self.assertEqual(page.headers["cache-control"], "no-cache")
            assets = re.findall(r'(?:src|href)="(/assets/[^"?]+)\?v=([a-f0-9]{16})"', page.text)
            self.assertTrue(assets, path)
            for asset, version in assets:
                response = self.client.get(asset + "?v=" + version)
                self.assertEqual(response.status_code, 200, asset)
                self.assertEqual(sha256(response.content).hexdigest()[:16], version)
                self.assertEqual(response.headers["cache-control"], "public, max-age=86400")
                old = self.client.get(asset + "?v=obsolete")
                self.assertEqual(old.headers["cache-control"], "public, max-age=300, must-revalidate")
        self.assertEqual(self.client.get("/health").headers["cache-control"], "no-store")
        self.assertEqual(self.client.get("/assets/missing.js").headers["cache-control"], "no-store")

    def test_canonical_home_matches_sitemap_and_robots(self):
        with patch('main.PUBLIC_URL', 'https://research.example'):
            html = self.client.get('/').text
            self.assertIn('rel="canonical" itemprop="url" href="https://research.example/"', html)
            self.assertIn('itemprop="name" content="ClearIntel Atlas"', html)
            self.assertIn('<title>ClearIntel Atlas | Global News Map &amp; Country Briefs</title>', html)
            self.assertIn('property="og:url" content="https://research.example/"', html)
            self.assertIn('<loc>https://research.example/</loc>', self.client.get('/sitemap.xml').text)
            self.assertIn('Sitemap: https://research.example/sitemap.xml', self.client.get('/robots.txt').text)

    def test_country_directory_and_sitemap_cover_every_profile(self):
        directory = self.client.get('/countries').text
        sitemap = self.client.get('/sitemap.xml').text
        for code in COUNTRIES:
            path = '/countries/' + code.lower()
            self.assertIn(f'href="{path}"', directory)
            self.assertIn(f'{path}</loc>', sitemap)
        self.assertIn('BBC Scotland', self.client.get('/countries/gb').text)
        self.assertIn('El Mundo', self.client.get('/countries/es').text)
        self.assertEqual(self.client.get('/countries/missing').status_code, 404)

    def test_private_routes_not_exposed(self):
        for route in ['/report','/case','/run','/state','/config/api_keys.json','/docs']:
            self.assertEqual(self.client.get(route).status_code,404,route)

    def test_news_api_returns_cautious_results(self):
        safe={'results':[],'sources_checked':['test'],'provider_errors':[],
              'notice':'No matching reports','window_start':'2026-11-19','window_end':'2026-11-19'}
        with patch('main.search_news',return_value=safe) as mock:
            r=self.client.post('/api/news',json={'query':'Iran bombing today','window':'24h','incident_only':True})
            self.assertEqual(r.status_code,200)
            self.assertEqual(r.json()['results'],[])
            self.assertTrue(mock.called)

    def test_search_without_a_subject_skips_providers(self):
        with patch('main.search_news') as provider:
            response = self.client.post('/api/news', json={'query': 'bombing today'})
            self.assertEqual(response.status_code, 400)
            self.assertIn('location or topic', response.json()['detail'])
            provider.assert_not_called()

    def test_two_character_search_is_accepted(self):
        with patch('main.search_news', return_value=SEARCH_RESPONSE) as provider:
            self.assertEqual(self.client.post('/api/news', json={'query': ' UK '}).status_code, 200)
            provider.assert_called_once_with('UK', days=1, incident_only=True)
            self.assertEqual(self.client.post('/api/news', json={'query': 'U'}).status_code, 422)
            self.assertIn('minlength="2"', self.client.get('/').text)

    def test_reject_invalid_window(self):
        r=self.client.post('/api/news',json={'query':'Iran bombing today','window':'forever'})
        self.assertEqual(r.status_code,422)

    def test_html_csp(self):
        r=self.client.get('/')
        self.assertIn("script-src 'self'",r.headers['content-security-policy'])
        self.assertEqual(r.headers['strict-transport-security'], 'max-age=31536000')

    def test_search_body_and_content_type_limits(self):
        with patch('main.search_news') as provider:
            self.assertEqual(self.client.post('/api/news', data={'query': 'London'}).status_code, 415)
            response = self.client.post('/api/news', json={'query': 'x' * 2048})
            self.assertEqual(response.status_code, 413)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            provider.assert_not_called()

    def test_repeated_searches_use_cache_but_count_toward_client_limit(self):
        with patch('main.search_news', return_value=SEARCH_RESPONSE) as provider:
            for attempt in range(5):
                response = self.client.post('/api/news', json={'query': 'London'})
                self.assertEqual(response.status_code, 200, attempt)
            response = self.client.post('/api/news', json={'query': 'London'},
                                        headers={'X-Forwarded-For': '192.0.2.1'})
            self.assertEqual(response.status_code, 429)
            self.assertGreater(int(response.headers['retry-after']), 0)
            provider.assert_called_once()

    def test_country_searches_have_independent_panel_limits(self):
        with patch('main.search_country_news', return_value=SEARCH_RESPONSE), patch('main.search_news', return_value=SEARCH_RESPONSE):
            for code in ('GB', 'ES', 'NL', 'FR', 'DE'):
                self.assertEqual(self.client.get('/api/country-news/' + code).status_code, 200)
                self.assertEqual(self.client.post('/api/news', json={'query': code}).status_code, 200)
            for response in (self.client.get('/api/country-news/IT'),
                             self.client.post('/api/news', json={'query': 'IT'})):
                self.assertEqual(response.status_code, 429)
                self.assertGreater(int(response.headers['retry-after']), 0)

    def test_site_limit_applies_across_client_addresses(self):
        other_client = TestClient(app, client=('93.184.216.35', 50000))
        with patch('main.SITE_SEARCHES_PER_MINUTE', 1):
            with patch('main.search_news', return_value=SEARCH_RESPONSE) as provider:
                self.assertEqual(self.client.post('/api/news', json={'query': 'London'}).status_code, 200)
                response = other_client.post('/api/news', json={'query': 'Bristol'})
                self.assertEqual(response.status_code, 429)
                provider.assert_called_once()

    def test_shared_proxy_uses_site_limit_without_trusting_forwarded_header(self):
        proxy = TestClient(app, client=('10.0.0.5', 50000))
        headers = {'X-Forwarded-For': '93.184.216.34'}
        with patch('main.SITE_SEARCHES_PER_MINUTE', 6):
            with patch('main.search_news', return_value=SEARCH_RESPONSE):
                for _ in range(6):
                    response = proxy.post('/api/news', json={'query': 'London'}, headers=headers)
                    self.assertEqual(response.status_code, 200)
                self.assertEqual(proxy.post('/api/news', json={'query': 'London'}).status_code, 429)

    def test_concurrency_limit_releases_after_provider_work(self):
        started, release = Event(), Event()

        def provider(*args, **kwargs):
            started.set()
            if not release.wait(5):
                raise AssertionError('Timed out waiting to release provider')
            return SEARCH_RESPONSE

        with patch('main.MAX_ACTIVE_PROVIDER_SEARCHES', 1), patch('main.search_news', side_effect=provider):
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(self.client.post, '/api/news', json={'query': 'London'})
                try:
                    self.assertTrue(started.wait(5))
                    self.assertEqual(self.client.post('/api/news', json={'query': 'Bristol'}).status_code, 429)
                finally:
                    release.set()
                self.assertEqual(pending.result().status_code, 200)
            self.assertEqual(self.client.post('/api/news', json={'query': 'Bristol'}).status_code, 200)

    def test_iss_refresh_is_shared_and_success_is_cached(self):
        started, release = Event(), Event()
        position = {'latitude': 1.0, 'longitude': 2.0, 'timestamp': 100}

        def provider():
            started.set()
            if not release.wait(5):
                raise AssertionError('Timed out waiting to release ISS provider')
            return position

        cache = {'data': None, 'expires': 0, 'error_expires': 0}
        with patch('main._iss_cache', cache), patch('main._iss_location', side_effect=provider) as fetch:
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(self.client.get, '/api/iss')
                try:
                    self.assertTrue(started.wait(5))
                    refreshing = self.client.get('/api/iss')
                    self.assertEqual(refreshing.status_code, 503)
                    self.assertEqual(refreshing.headers['retry-after'], '2')
                finally:
                    release.set()
                self.assertEqual(pending.result().json(), position)
            self.assertEqual(self.client.get('/api/iss').json(), position)
            fetch.assert_called_once()

if __name__=='__main__':
    unittest.main()
