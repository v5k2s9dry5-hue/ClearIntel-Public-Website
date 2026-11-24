import unittest
from unittest.mock import patch
import globe_texture as g

class GlobeTextureTests(unittest.TestCase):
    def setUp(self):
        self.original = (g._texture, g._retry_at)
        g._texture, g._retry_at = None, 0

    def tearDown(self):
        g._texture, g._retry_at = self.original

    def test_download_is_reused(self):
        fixture = b"\xff\xd8fixture\xff\xd9"
        with patch.object(g, "_download", return_value=fixture) as download:
            self.assertEqual(g.texture().body, fixture)
            self.assertEqual(g.texture().body, fixture)
            download.assert_called_once()

    def test_failure_has_backoff(self):
        with patch.object(g, "_download", side_effect=OSError) as download:
            self.assertEqual(g.texture().status_code, 503)
            self.assertEqual(g.texture().status_code, 503)
            download.assert_called_once()
