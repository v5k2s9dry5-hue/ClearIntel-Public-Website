from unittest import TestCase
from urllib.error import HTTPError
from feed_retry import retry_delay


class RetryDelayTests(TestCase):
    def test_retry_seconds_and_http_date(self):
        def error(header, code=429):
            return HTTPError('https://example.invalid', code, '', {'Retry-After': header}, None)
        self.assertEqual(retry_delay(error('180')), 180)
        self.assertEqual(retry_delay(error('Thu, 01 Jan 1970 00:03:00 GMT'), now=0), 180)
        self.assertEqual(retry_delay(error('invalid')), 60)
        self.assertEqual(retry_delay(error('5', 503)), 30)
        self.assertEqual(retry_delay(TimeoutError()), 30)
