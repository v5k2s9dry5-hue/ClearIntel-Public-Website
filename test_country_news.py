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

    def test_distinct_top_three_and_identical_syndicated_copy(self):
        lead = 'Kenya parliament votes on national housing reforms'
        rows = [dict(article(lead, 'first.example', 2), publisher_rank=1),
                article(lead, 'copy.example', 1),
                article('Kenya introduces rail timetable', 'rail.example', 4),
                article('Kenya hosts regional climate summit', 'climate.example', 3),
                article('Kenya prepares for rainy season', 'weather.example', 5)]
        result = search_country_news('KE', NOW, (fixture_provider(*rows),))
        self.assertEqual(len(result['stories']), 3)
        self.assertEqual(result['stories'][0]['basis'], 'publisher')
        self.assertEqual(len(result['stories'][0]['reports']), 1)
        self.assertEqual(result['story'], result['stories'][0]['reports'])
        self.assertEqual(result['stories'][1]['reports'][0]['source'], 'climate.example')

    def test_only_valid_single_report_is_labelled_recent(self):
        provider = fixture_provider(
            article('US issues flood warnings', 'future.example', -1),
            article('Tell us your views about flooding', 'unrelated.example', 1),
            article('US responds to floods', '[malformed', 1),
            article('US reports flood damage', 'old.example', 48),
            article('US reports floods', 'valid.example', 2),
        )
        result = search_country_news('US', NOW, (provider,))
        self.assertEqual(result['basis'], 'recent')
        self.assertEqual([row['source'] for row in result['story']], ['valid.example'])

    def test_spain_publisher_order_and_weekly_fallback(self):
        lead = dict(article('El Congreso debate el presupuesto', 'elpais.example', 4),
                    country_code='ES', publisher_rank=1)
        latest = dict(article('Una nueva estación', 'elpais.example', 1),
                      country_code='ES', publisher_rank=2)
        result = search_country_news('ES', NOW, (fixture_provider(latest, lead),))
        self.assertEqual(result['basis'], 'publisher')
        self.assertEqual(result['story'][0]['title'], lead['title'])
        earlier = dict(lead, published=(NOW - timedelta(days=4)).isoformat())
        result = search_country_news('ES', NOW, (fixture_provider(earlier),))
        self.assertEqual(result['basis'], 'weekly')
        self.assertEqual(search_country_news('PT', NOW, (fixture_provider(earlier),))['story'], [])

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

    def test_uk_timeline_links_a_recent_national_story_without_claiming_it_is_breaking(self):
        from current_events import parse_country_timeline

        text = """== Events ==
===November===
* 19 November
**Old story.<ref>{{Cite web |url=https://publisher.example/old |website=Daily Paper}}</ref>
* 20 November
**The UK and the EU reach a trade deal.<ref name="repeat"/><ref>{{Cite web |url=https://publisher.example/deal |website=Daily Paper}}</ref>
=== Predicted and scheduled events ===
* 21 November – A future event.<ref>{{Cite web |url=https://publisher.example/predicted}}</ref>
== References ==
"""
        rows = parse_country_timeline(text, 2026, 'https://en.wikipedia.org/wiki/2026_in_the_United_Kingdom', 'GB', 'UK')
        self.assertEqual(len(rows), 2)
        result = search_country_news('GB', NOW, (fixture_provider(*rows),))
        self.assertEqual(result['basis'], 'national_digest')
        self.assertEqual(result['story'][0]['url'], 'https://publisher.example/deal')
        self.assertEqual(result['story'][0]['time_basis'], 'Event date')
        self.assertEqual(result['story'][0]['attribution_title'], 'Wikipedia’s UK events timeline')

    def test_explicit_uk_city_headline_gets_precise_mention_not_incident_claim(self):
        from country_news import _city_mention
        self.assertEqual(_city_mention('Manchester launches new bus network', 'GB')['city'], 'Manchester')
        self.assertIsNone(_city_mention('ManchesterUnited releases a statement', 'GB'))
        self.assertIsNone(_city_mention('Manchester launches new bus network', 'ES'))
        rows = [
            dict(article('Council announces roadworks in Manchester', 'north.example', 1), country_code='GB'),
            dict(article('Bristol council launches new initiative', 'west.example', 2), country_code='GB'),
            dict(article('Council announces roadworks in Manchester', 'north.example', 50), country_code='GB'),
        ]
        result = search_country_news('GB', NOW, (fixture_provider(*rows),))
        self.assertEqual([item['city'] for item in result['city_mentions']], ['Manchester', 'Bristol'])
        self.assertTrue(all(item['label'] == 'Headline mentions city' for item in result['city_mentions']))
        self.assertTrue(all(item['url'].startswith('https://') for item in result['city_mentions']))

    def test_spanish_city_alias_and_editorial_section_feeds(self):
        from country_news import _city_mention, REGIONAL_FEEDS
        self.assertEqual(_city_mention('El ayuntamiento de Sevilla anuncia inversiones', 'ES')['city'], 'Sevilla')
        self.assertEqual(_city_mention('Noticias de Seville hoy', 'ES')['city'], 'Sevilla')
        self.assertEqual(_city_mention('Málaga anuncia obras en el puerto', 'ES')['city'], 'Málaga')
        self.assertIn('news/england/rss.xml', REGIONAL_FEEDS['GB'][0][1])
        self.assertIn('elmundo/rss/espana.xml', REGIONAL_FEEDS['ES'][0][1])

    def test_international_country_adjectives_and_word_boundaries(self):
        cases = {
            'NL': 'Dutch parliament approves transport budget',
            'CA': 'Canadian lawmakers debate housing policy',
            'CN': 'Chinese government announces new trade rules',
            'SE': 'Swedish election campaign begins',
            'PH': 'Philippine authorities release storm update',
            'PL': 'Polish parliament debates new budget',
        }
        for code, title in cases.items():
            with self.subTest(code=code):
                result = search_country_news(code, NOW, (fixture_provider(
                    article(title, 'local.example', 1),
                    article('Unrelated transport news', 'other.example', 1)),))
                self.assertEqual(result['story'][0]['title'], title)
        unrelated = article('How to polish your car', 'other.example', 1)
        self.assertEqual(search_country_news('PL', NOW, (fixture_provider(unrelated),))['stories'], [])

    def test_empty_national_edition_falls_back_to_named_search(self):
        from country_news import _fetch_country_reports, ALIASES
        with (patch('country_news._fetch_edition', return_value=[]),
              patch('country_news.fetch_google', return_value=[
                  article('Dutch parliament votes on budget', 'local.example', 1)
              ]) as google,
              patch('country_news._collect') as collect):
            def run_regional(query, days, incident_only, providers, **kwargs):
                return providers[0](query, days, incident_only), ['edition'], []
            collect.side_effect = run_regional
            rows, _, _ = _fetch_country_reports('NL', 'Netherlands',
                                                ('Netherlands', *ALIASES['NL']), NOW)
            self.assertEqual(len(rows), 1)
            self.assertIn('"Dutch"', google.call_args.kwargs['topic'])
            self.assertNotIn('edition_rank', rows[0])

    def test_malformed_edition_xml_falls_back_to_named_search(self):
        from country_news import _fetch_country_reports
        from xml.etree.ElementTree import ParseError
        with (patch('country_news._fetch_edition', side_effect=ParseError('invalid XML')),
              patch('country_news.fetch_google', return_value=[]) as google,
              patch('country_news._collect') as collect):
            collect.side_effect = lambda query, days, incident_only, providers, **kwargs: providers[0](query, days, incident_only)
            _fetch_country_reports('NL', 'Netherlands', ('Netherlands', 'Dutch'), NOW)
            google.assert_called_once()

    def test_country_edition_http_error_is_not_retried(self):
        from urllib.error import HTTPError
        from country_news import _fetch_country_reports
        with (patch('country_news._fetch_edition', side_effect=HTTPError(
                  'https://news.google.com/', 429, 'rate limited', None, None)),
              patch('country_news.fetch_google') as google,
              patch('country_news._collect') as collect):
            def run_regional(query, days, incident_only, providers, **kwargs):
                return providers[0](query, days, incident_only)
            collect.side_effect = run_regional
            with self.assertRaises(HTTPError):
                _fetch_country_reports('NL', 'Netherlands', ('Netherlands', 'Dutch'), NOW)
            google.assert_not_called()

    def test_regional_publisher_coverage_does_not_claim_national_ranking(self):
        from country_news import _publisher_reports
        feed = b'''<rss><channel><item><title>Cardiff transport upgrade</title>
            <link>https://example.org/cardiff</link><pubDate>Sat, 21 Nov 2026 11:00:00 GMT</pubDate>
            </item></channel></rss>'''
        with patch('country_news._get', return_value=feed):
            result = _publisher_reports('https://example.org/rss.xml', 'Regional desk', 'GB', False)
        self.assertEqual(result[0]['country_code'], 'GB')
        self.assertIsNone(result[0]['publisher_rank'])
        self.assertEqual(result[0]['source'], 'Regional desk')

    def test_invalid_publisher_items_fail_coverage_check(self):
        from country_news import _publisher_reports
        malformed = b"<rss><channel><item><title>Missing date and link</title></item></channel></rss>"
        with patch('country_news._get', return_value=malformed):
            with self.assertRaises(ValueError):
                _publisher_reports('https://example.org/rss', 'Fixture', 'GB', True)
        with patch('country_news._get', return_value=b"<rss><channel/></rss>"):
            self.assertEqual(_publisher_reports('https://example.org/rss', 'Fixture', 'GB', True), [])

    def test_publisher_xml_rejects_entities(self):
        from country_news import _publisher_reports
        with patch('country_news._get', return_value=b'<!DOCTYPE rss><rss><channel/></rss>'):
            with self.assertRaises(ValueError):
                _publisher_reports('https://example.org/rss', 'Fixture', 'GB', True)
