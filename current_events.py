"""Recent, already-published news summaries from Wikipedia's Current events portal."""

from functools import lru_cache
from html.parser import HTMLParser
import json
import re
from urllib.parse import urlencode

from news import _get, _safe_link

PORTAL = 'https://en.wikipedia.org/wiki/Portal:Current_events'


class CurrentEventsParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.day = ''
        self.in_date = False
        self.content_depth = 0
        self.items = []
        self.records = []
        self.category = ''
        self.in_category = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get('class', '').split()
        if tag == 'span' and 'dtstart' in classes:
            self.in_date = True
        if tag == 'div' and (self.content_depth or 'current-events-content' in classes):
            if not self.content_depth:
                self.category = ''
                self.in_category = False
            self.content_depth += 1
        if not self.content_depth:
            return
        if tag == 'b' and not self.items:
            self.category = ''
            self.in_category = True
        if tag == 'li':
            if self.items:
                self.items[-1]['has_children'] = True
            self.items.append({'parts': [], 'links': [], 'in_source': False, 'has_children': False, 'topics': []})
        if tag == 'a' and self.items:
            item = self.items[-1]
            url = attrs.get('href', '')
            if 'external' in classes and _safe_link(url):
                item['links'].append({'url': url, 'parts': []})
                item['in_source'] = True
            elif url.startswith('/wiki/') and attrs.get('title'):
                item['topics'].append(attrs['title'])

    def handle_data(self, text):
        if self.in_date and re.fullmatch(r'\d{4}-\d{2}-\d{2}', text.strip()):
            self.day = text.strip()
        if self.in_category:
            self.category += text
        if not self.items:
            return
        item = self.items[-1]
        if item['in_source']:
            item['links'][-1]['parts'].append(text)
        else:
            item['parts'].append(text)

    def handle_endtag(self, tag):
        if tag == 'span' and self.in_date:
            self.in_date = False
        if not self.content_depth:
            return
        if tag == 'b':
            self.in_category = False
        if tag == 'a' and self.items:
            self.items[-1]['in_source'] = False
        if tag == 'div':
            self.content_depth -= 1
        if tag != 'li' or not self.items:
            return
        item = self.items.pop()
        summary = ' '.join(''.join(item['parts']).split())
        if (self.day and not item['has_children'] and item['links'] and summary
                and self.category.strip().casefold() not in ('sports', 'sport')):
            sources = [
                {'url': link['url'], 'name': ''.join(link['parts']).strip(' ()')}
                for link in item['links'][:3]
            ]
            self.records.append({
                'title': summary, 'published': self.day + 'T00:00:00Z',
                'url': sources[0]['url'], 'source': sources[0]['name'],
                'time_basis': 'Event date', 'editorial': True,
                'citations': sources, 'topics': item['topics'],
            })


@lru_cache(maxsize=2)
def editorial_events(_cache_interval):
    params = urlencode({
        'action': 'parse', 'page': 'Portal:Current_events', 'prop': 'text|revid',
        'format': 'json', 'formatversion': 2,
    })
    page = json.loads(_get('https://en.wikipedia.org/w/api.php?' + params))['parse']
    parser = CurrentEventsParser()
    parser.feed(page['text'])
    if not parser.records:
        raise ValueError('Current events format unavailable')
    attribution = PORTAL
    if type(page.get('revid')) is int:
        attribution = f'https://en.wikipedia.org/w/index.php?oldid={page["revid"]}'
    return [dict(record, attribution_url=attribution) for record in parser.records]
