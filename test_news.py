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

    def test_duplicate_headlines_keep_a_stable_copy_with_publication_time(self):
        title = "United Kingdom rail services disrupted by flooding"
        rows = [
            {"title": title, "url": "https://example.org/report", "published": NOW.isoformat(),
             "source": "Example News", "provider": "GDELT", "time_basis": "First seen by GDELT"},
            {"title": title + " - Example News", "url": "https://news.google.com/rss/articles/example",
             "published": (NOW - timedelta(hours=3)).isoformat(), "source": "Example News",
             "provider": "Google News", "time_basis": "Publication time via Google News"},
            {"title": title, "url": "https://example.org/report", "published": (NOW - timedelta(hours=2)).isoformat(),
             "source": "Example News", "provider": "Bing News", "time_basis": "Publication time via Bing News"},
        ]
        left = search_news("UK rail", now=NOW, incident_only=False, fetchers=[fake(rows)])["results"]
        right = search_news("UK rail", now=NOW, incident_only=False, fetchers=[fake(rows[::-1])])["results"]
        self.assertEqual(left, right)
        self.assertEqual(len(left), 1)
        self.assertEqual(left[0]["provider"], "Bing News")
        self.assertEqual(left[0]["url"], "https://example.org/report")
        self.assertEqual(left[0]["feed_time_utc"], (NOW - timedelta(hours=2)).isoformat())

    def test_suffix_only_stripped_when_it_is_the_publisher(self):
        rows = [{"title": title, "url": f"https://example.org/{index}", "published": NOW.isoformat(),
                 "source": source} for index, (title, source) in enumerate([
            ("Rail investigation - United Kingdom", "Rail Desk"),
            ("Rail investigation - United States", "Rail Desk"),
            ("Rail investigation - UK Rail Desk", "UK Rail Desk"),
        ])]
        result = search_news("rail investigation", now=NOW, incident_only=False, fetchers=[fake(rows)])
        self.assertEqual({row["title"] for row in result["results"]},
                         {"Rail investigation - United Kingdom", "Rail investigation - United States",
                          "Rail investigation"})
        uk = search_news("UK", now=NOW, incident_only=False, fetchers=[fake([rows[-1]])])
        self.assertEqual(uk["results"], [])

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
        self.assertIn('all queried feeds failed', r['notice'])
        # One successful empty feed is different from a total provider outage.
        partial = search_news('Iran bombing', now=NOW, fetchers=[down, fake([])])
        self.assertEqual(len(partial['sources_checked']), 1)
        self.assertEqual(len(partial['provider_errors']), 1)
        self.assertNotIn('all queried feeds failed', partial['notice'])


if __name__=='__main__':
    unittest.main()
