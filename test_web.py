import unittest
from fastapi.testclient import TestClient
from unittest.mock import patch
from main import app

class PublicSiteTests(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(app)

    def test_home_and_health(self):
        self.assertEqual(self.client.get('/').status_code,200)
        self.assertIn('ClearIntel',self.client.get('/').text)
        self.assertEqual(self.client.get('/health').json()['status'],'ok')

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

    def test_reject_invalid_window(self):
        r=self.client.post('/api/news',json={'query':'Iran bombing today','window':'forever'})
        self.assertEqual(r.status_code,422)

    def test_html_csp(self):
        r=self.client.get('/')
        self.assertIn("script-src 'self'",r.headers['content-security-policy'])

if __name__=='__main__':
    unittest.main()
