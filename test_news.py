import unittest
from datetime import datetime, timedelta, timezone
from news import _date, _provider_topic, _relevance, _subject, search_news

NOW=datetime(2026,11,19,17,0,tzinfo=timezone.utc)


def fake(rows):
    def provider(query,days,incident_only=True):
        return rows
    return provider


class NewsTests(unittest.TestCase):
    def test_user_query_becomes_subject(self):
        self.assertEqual(_subject('Iran bombing today'), ['iran'])
        self.assertEqual(_subject('Bahrain missiles today'), ['bahrain'])

    def test_short_country_queries_match_full_names(self):
        self.assertIn('"United Kingdom"', _provider_topic('UK'))
        self.assertGreater(_relevance('New United Kingdom trade figures published', ['uk'], False), 0)
        self.assertEqual(_relevance('Tell us your views', ['us'], False), -1)

    def test_filters_old_and_speculative_titles(self):
        rows=[
            {'title':'Iran 2019 bombing history','url':'https://example.org/old','published':(NOW-timedelta(days=100)).isoformat(),'source':'Publisher','provider':'test'},
            {'title':'Official warns of possible airstrikes in Iran','url':'https://example.org/warn','published':NOW.isoformat(),'source':'Publisher','provider':'test'},
            {'title':'Explosion reported in Iran near airport','url':'https://example.org/new','published':NOW.isoformat(),'source':'Publisher','provider':'test'},
            {'title':'Explosion reported in Peru','url':'https://example.org/peru','published':NOW.isoformat(),'source':'Publisher','provider':'test'},
        ]
        r=search_news('Iran bombing today',now=NOW,fetchers=[fake(rows)])
        self.assertEqual(len(r['results']),1)
        self.assertIn('Explosion reported',r['results'][0]['title'])
        self.assertEqual(r['results'][0]['feed_time_utc'], NOW.isoformat())
        self.assertIsNone(r['results'][0]['incident_time_utc'])
        self.assertIn('NOT independently confirmed',r['notice'])

    def test_no_fake_event_when_only_political_commentary(self):
        rows=[{'title':'Trump threatens possible bombing of Iran','url':'https://example.org/a',
               'published':NOW.isoformat(),'source':'Publisher','provider':'test'},
              {'title':'Trump discusses airstrikes on Iran in interview','url':'https://example.org/b',
               'published':NOW.isoformat(),'source':'Publisher','provider':'test'}]
        r=search_news('Iran bombing today',now=NOW,fetchers=[fake(rows)])
        self.assertEqual(r['results'],[])
        self.assertIn('does not prove',r['notice'])
        r=search_news('Iran bombing today',incident_only=False,now=NOW,fetchers=[fake(rows)])
        self.assertEqual(len(r['results']), 2)

    def test_commentary_headline_with_reported_incident(self):
        self.assertGreaterEqual(
            _relevance('Officials discuss response after explosions reported in Iran', ['iran'], True),
            0,
        )

    def test_bad_and_insecure_links_rejected(self):
        rows=[{'title':'Iran explosion','url':url,'published':NOW.isoformat()} for url in
              ('http://example.com','javascript:alert(1)','https://name:pass@example.com')]
        r=search_news('Iran explosion',now=NOW,fetchers=[fake(rows)])
        self.assertFalse(r['results'])

    def test_country_section_matches_without_repeating_country_name(self):
        rows = [{'title': 'Parliament passes the budget', 'country_code': 'GB',
                 'url': 'https://example.org/budget', 'published': NOW.isoformat()}]
        def lookup(query, code, incidents):
            return search_news(query, now=NOW, country_code=code, fetchers=[fake(rows)],
                               incident_only=incidents)['results']
        self.assertEqual(len(lookup('uk', 'GB', False)), 1)
        self.assertFalse(lookup('uk', 'GB', True))
        self.assertFalse(lookup('spain', 'ES', False))

    def test_date_formats(self):
        self.assertEqual(_date('20261119T170000Z'),NOW)
        self.assertEqual(_date('Thu, 19 Nov 2026 17:00:00 GMT'),NOW)

    def test_provider_outage_visible(self):
        def down(query,days,incident_only=True):
            raise RuntimeError('Fake API secret: not public')
        r=search_news('Iran bombing',now=NOW,fetchers=[down])
        self.assertEqual(r['sources_checked'],[])
        self.assertNotIn('Fake API secret',str(r))
        self.assertTrue(r['provider_errors'])


if __name__=='__main__':
    unittest.main()
