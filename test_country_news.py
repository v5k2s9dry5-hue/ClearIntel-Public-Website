from datetime import datetime, timedelta, timezone
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from country_news import search_country_news
from current_events import CurrentEventsParser
from news import _parse_google_rss


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
        self.assertEqual(result['basis'], 'developing')
        self.assertEqual([story['source'] for story in result['story']], ['one.example', 'two.example'])

    def test_stale_unsafe_and_single_unranked_results_do_not_make_a_lead(self):
        provider = fixture_provider(
            article('US issues flood warnings', 'future.example', -1),
            article('Tell us your views about flooding', 'unrelated.example', 1),
            article('US responds to floods', '[malformed', 1),
            article('US reports flood damage', 'old.example', 48),
            article('US reports floods', 'valid.example', 2),
        )
        result = search_country_news('US', NOW, (provider,))
        self.assertEqual(result['basis'], 'unavailable')
        self.assertEqual(result['story'], [])

    def test_national_edition_order_beats_age_and_country_name_matching(self):
        lead = dict(article('MPs reject the draft budget', 'lead.example', 9),
                    edition_rank=1, country_code='GB')
        latest = dict(article('Teams prepare for Saturday’s match', 'sports.example', 1),
                      edition_rank=4, country_code='GB')
        unrelated = dict(article('Politics in Atlanta', 'atlanta.example', 1),
                         edition_rank=1, country_code='US')
        result = search_country_news('GB', NOW, (fixture_provider(lead, latest, unrelated),))
        self.assertEqual(result['basis'], 'national')
        self.assertEqual(result['story'][0]['source'], 'lead.example')

    def test_edition_parser_rejects_a_different_country(self):
        rss = b'<rss><channel><link>https://news.google.com/?gl=US&amp;ceid=US:en</link></channel></rss>'
        with self.assertRaisesRegex(ValueError, 'wrong country edition'):
            _parse_google_rss(rss, country_code='GB')

    def test_current_events_keep_source_links_and_match_the_location(self):
        parser = CurrentEventsParser()
        parser.feed('''
          <span class="dtstart">2026-11-21</span><div class="current-events-content">
          <p><b>Politics and elections</b></p><ul><li>International talks
          <ul><li>The <a href="/wiki/British_Foreign_Office" title="British Foreign Office">UK Foreign Office</a>
          comments on elections in <a href="/wiki/France" title="France">France</a>.
          <a class="external text" href="https://one.example/fr">(<i>Local Press</i>)</a></li></ul></li></ul>
          <p><b>Sports</b></p><ul><li>A team wins in <a title="France" href="/wiki/France">France</a>.
          <a class="external text" href="https://sports.example/fr">Sports Wire</a></li></ul></div>
        ''')
        self.assertEqual(len(parser.records), 1)
        provider = fixture_provider(*parser.records)
        result = search_country_news('FR', NOW, (provider,))
        self.assertEqual(result['basis'], 'editorial')
        self.assertEqual(result['story'][0]['citations'], [
            {'url': 'https://one.example/fr', 'name': 'Local Press'},
        ])
        self.assertEqual(search_country_news('GB', NOW, (provider,))['story'], [])

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

    def test_official_updates_never_fill_a_missing_headline(self):
        update = dict(article('UK publishes a government statement', 'gov.uk', 1),
                      country_code='GB', edition_rank=1)
        second = dict(article('UK publishes an agency statement', 'agency.example', 2),
                      country_code='GB', edition_rank=2, official=True)
        result = search_country_news('GB', NOW, (fixture_provider(update, second),))
        self.assertEqual(result['basis'], 'unavailable')
        self.assertEqual(result['story'], [])
