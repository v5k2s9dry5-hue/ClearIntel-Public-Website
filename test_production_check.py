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

    def test_expected_commit_matches_live_build_and_rejects_stale_deployment(self):
        deployed = "b" * 40
        with patch("main.PUBLIC_URL", DEFAULT_BASE), patch.dict(
                "os.environ", {"RENDER_GIT_COMMIT": deployed}), TestClient(app) as client:
            def fetch(url):
                response = client.get(urlsplit(url).path)
                return response.status_code, response.headers, response.text

            checks = dict(check(DEFAULT_BASE, fetch, expected_commit=deployed))
            self.assertTrue(checks["Public build endpoint is minimal and valid"])
            self.assertTrue(checks["Live deployment matches expected Git commit"])
            older_checks = dict(check(DEFAULT_BASE, fetch, expected_commit="c" * 40))
            self.assertFalse(older_checks["Live deployment matches expected Git commit"])
            self.assertTrue(older_checks["Public build endpoint is minimal and valid"])

    def test_missing_or_malformed_build_fails_expected_deployment_check(self):
        with patch("main.PUBLIC_URL", DEFAULT_BASE), TestClient(app) as client:
            def fetch(url):
                path = urlsplit(url).path
                response = client.get(path)
                if path == "/api/build":
                    return 200, response.headers, '{"product":"ClearIntel Atlas","git_commit":"bad","secret":"never"}'
                return response.status_code, response.headers, response.text

            checks = dict(check(DEFAULT_BASE, fetch, expected_commit="b" * 40))
            self.assertFalse(checks["Public build endpoint is minimal and valid"])
            self.assertFalse(checks["Live deployment matches expected Git commit"])

    def test_rejects_malformed_commit_before_network_requests(self):
        with self.assertRaises(ValueError):
            check(DEFAULT_BASE, expected_commit="not-a-git-sha")

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

    def test_detects_missing_navigation_and_duplicate_descriptions(self):
        with patch("main.PUBLIC_URL", DEFAULT_BASE), TestClient(app) as client:
            def fetch(url):
                path = urlsplit(url).path
                response = client.get(path)
                body = response.text
                if path == "/":
                    body = body.replace('href="/countries"', 'href="#countries"')
                elif path == "/countries":
                    body = body.replace('href="/countries/es"', 'href="#spain"')
                elif path == "/countries/es":
                    body = client.get("/countries/gb").text
                return response.status_code, response.headers, body

            results = dict(check(DEFAULT_BASE, fetch))
            self.assertFalse(results["Homepage links to country directory"])
            self.assertFalse(results["/countries/es linked from directory"])
            self.assertFalse(results["Sampled public pages have distinct descriptions"])

    def test_unavailable_site_is_not_reported_as_passed(self):
        def offline(url):
            raise OSError("offline")
        self.assertFalse(any(passed for _, passed in check(DEFAULT_BASE, offline)))

    def test_old_dashboard_does_not_pass_redesign_verification(self):
        with patch("main.PUBLIC_URL", DEFAULT_BASE), TestClient(app) as client:
            def fetch(url):
                path = urlsplit(url).path
                response = client.get(path)
                body = response.text
                if path == "/":
                    body = body.replace('id="map-layer-source"', 'id="legacy-map-source"')
                if path == "/assets/dashboard-visual.css":
                    body = "/* Old stylesheet */"
                return response.status_code, response.headers, body

            results = dict(check(DEFAULT_BASE, fetch))
            self.assertFalse(results["Redesigned dashboard markup"])
            self.assertFalse(results["Redesigned dashboard assets"])
            self.assertTrue(results["Homepage canonical"])

    def test_invalid_origin_rejected(self):
        with self.assertRaises(ValueError):
            check("http://clearintel.example")
