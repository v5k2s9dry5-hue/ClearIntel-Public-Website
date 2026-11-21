from datetime import datetime, timedelta, timezone
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from country_news import search_country_news


NOW = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)


def article(title, domain, hours_ago, *, via_google=False):
    publisher = f'https://{domain}'
    return {
        'title': title, 'source': domain,
        'url': f'{publisher}/story' if not via_google else 'https://news.google.com/rss/articles/42',
        'publisher_url': publisher if via_google else '',
        'published': (NOW - timedelta(hours=hours_ago)).isoformat(),
        'time_basis': 'Publication time',
    }


def fixture_provider(*articles):
    def fetch(_query, _days, _incident_only, *, topic):
        return articles
    return fetch


class CountryNewsTests(TestCase):
    def test_rank_similar_headlines_from_distinct_publishers(self):
        title = 'France announces a new national climate investment plan'
        provider = fixture_provider(
            article('France opens a new rail station', 'newest.example', 1),
            article(title, 'one.example', 2),
            article(title, 'one.example', 3, via_google=True),
            article(title + ' today', 'two.example', 4),
            article('Rain causes delays across Spain', 'unrelated.example', 1),
        )
        result = search_country_news('FR', NOW, (provider,))
        self.assertEqual(result['window_hours'], 24)
        self.assertEqual([story['source'] for story in result['story']], ['one.example', 'two.example'])

    def test_older_coverage_can_fallback_and_unsafe_or_future_results_are_ignored(self):
        provider = fixture_provider(
            article('US issues flood warnings', 'future.example', -1),
            article('Tell us your views about flooding', 'unrelated.example', 1),
            article('US responds to floods', '[malformed', 1),
            article('US reports flood damage', 'valid.example', 48),
        )
        result = search_country_news('US', NOW, (provider,))
        self.assertEqual(result['window_hours'], 168)
        self.assertEqual([item['source'] for item in result['story']], ['valid.example'])

    def test_georgia_filters_out_a_us_state_headline(self):
        provider = fixture_provider(
            article('Georgia wins college football match', 'sports.example', 1),
            article('Talks resume in Tbilisi', 'world.example', 3),
        )
        result = search_country_news('GE', NOW, (provider,))
        self.assertEqual(result['story'][0]['source'], 'world.example')

    def test_endpoint_accepts_a_known_country_and_caches_results(self):
        result = {'story': [], 'sources_checked': ['fixture'], 'provider_errors': []}
        with (patch.object(main, 'search_country_news', return_value=result) as search,
              patch.object(main, '_search_cache', main.OrderedDict()),
              patch.object(main, '_site_searches', main.deque()),
              TestClient(main.app) as client):
            self.assertEqual(client.get('/api/country-news/ZZ').status_code, 404)
            self.assertEqual(client.get('/api/country-news/GB').json(), result)
            self.assertEqual(client.get('/api/country-news/GB').json(), result)
            search.assert_called_once_with('GB')
