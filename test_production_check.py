from unittest import TestCase
from unittest.mock import patch
from urllib.parse import urlsplit

from fastapi.testclient import TestClient
from main import app
from scripts.check_production import check, DEFAULT_BASE


class ProductionCheckTests(TestCase):
    def test_local_application_passes_public_contract(self):
        with patch("main.PUBLIC_URL", DEFAULT_BASE), TestClient(app) as client:
            def fetch(url):
                response = client.get(urlsplit(url).path)
                return response.status_code, response.headers, response.text

            checks = check(DEFAULT_BASE, fetch)
            self.assertTrue(all(passed for _, passed in checks), checks)

    def test_detects_incorrect_canonical_and_missing_verification(self):
        with patch("main.PUBLIC_URL", "https://different.example"), TestClient(app) as client:
            def fetch(url):
                path = urlsplit(url).path
                if path.startswith("/google"):
                    return 404, {}, ""
                response = client.get(path)
                return response.status_code, response.headers, response.text

            results = dict(check(DEFAULT_BASE, fetch))
            self.assertFalse(results["Homepage canonical"])
            self.assertFalse(results["Google verification file"])
            self.assertFalse(results["Sitemap matches country directory"])

    def test_unavailable_site_is_not_reported_as_passed(self):
        def offline(url):
            raise OSError("offline")
        self.assertFalse(any(passed for _, passed in check(DEFAULT_BASE, offline)))

    def test_invalid_origin_rejected(self):
        with self.assertRaises(ValueError):
            check("http://clearintel.example")
