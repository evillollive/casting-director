"""Source connectors use public API contracts and never need live network in CI."""
import urllib.error
from datetime import datetime, timezone

import pytest

from sources import (
    GitHubSource,
    HackadaySource,
    HackerNewsSource,
    HttpClient,
    ItchSource,
    RedditSource,
    SourceFetch,
    collect_sources,
)
from sources.feed import parse_rss
from sources.itch import itch_creator_from_link

SINCE = datetime(2026, 8, 1, tzinfo=timezone.utc)


class StubHttp:
    def __init__(self, *, json_by_url=None, text_by_url=None, errors=None):
        self.json_by_url = json_by_url or {}
        self.text_by_url = text_by_url or {}
        self.errors = errors or set()
        self.calls = []

    def get_json(self, url, **kwargs):
        self.calls.append(("json", url, kwargs))
        if url in self.errors:
            raise OSError("blocked")
        return self.json_by_url[url]

    def get_text(self, url, **kwargs):
        self.calls.append(("text", url, kwargs))
        if url in self.errors:
            raise OSError("blocked")
        return self.text_by_url[url]


def test_hacker_news_uses_show_hn_date_query():
    client = StubHttp(
        json_by_url={
            HackerNewsSource.endpoint: {
                "hits": [
                    {
                        "objectID": "123",
                        "title": "Show HN: Camera-ready maps",
                        "author": "janeb",
                        "url": "https://example.test/maps",
                        "story_text": "How it was built",
                        "created_at_i": int(SINCE.timestamp()) + 60,
                    }
                ],
                "nbPages": 1,
            }
        }
    )
    result = HackerNewsSource(client).fetch(SINCE)
    candidate = result.candidates[0]
    assert candidate.project == "Camera-ready maps"
    assert candidate.source_family == "hacker-news"
    assert candidate.source_url == "https://news.ycombinator.com/item?id=123"
    params = client.calls[0][2]["params"]
    assert params["tags"] == "show_hn"
    assert params["numericFilters"] == f"created_at_i>{int(SINCE.timestamp())}"
    assert params["page"] == 0


def test_hacker_news_collects_later_pages_and_stops_at_nbpages():
    class PagingHttp:
        def __init__(self):
            self.pages = []

        def get_json(self, url, **kwargs):
            page = kwargs["params"]["page"]
            self.pages.append(page)
            hits = [
                {
                    "objectID": f"{page}-{index}",
                    "title": f"Show HN: Project {page}-{index}",
                    "author": f"builder-{page}-{index}",
                    "created_at_i": int(SINCE.timestamp()) + 60 + page * 10 + index,
                }
                for index in range(2)
            ]
            return {"hits": hits, "page": page, "nbPages": 3}

    client = PagingHttp()
    result = HackerNewsSource(client, max_results=10).fetch(SINCE)

    assert client.pages == [0, 1, 2]
    assert len(result.candidates) == 6
    assert result.candidates[-1].fingerprint == "hn:2-1"

    capped_client = PagingHttp()
    capped = HackerNewsSource(capped_client, max_results=3).fetch(SINCE)
    assert capped_client.pages == [0, 1]
    assert len(capped.candidates) == 3


def test_github_searches_recent_starred_repositories_and_reads_readme():
    search = GitHubSource.endpoint
    readme = "https://api.github.com/repos/janeb/visible-demo/readme"
    client = StubHttp(
        json_by_url={
            search: {
                "items": [
                    {
                        "id": 99,
                        "full_name": "janeb/visible-demo",
                        "html_url": "https://github.com/janeb/visible-demo",
                        "description": "A visual demo",
                        "owner": {"login": "janeb"},
                    }
                ]
            }
        },
        text_by_url={readme: "# Build story\nDetailed notes."},
    )
    result = GitHubSource(client, token="token").fetch(SINCE)
    candidate = result.candidates[0]
    assert candidate.fingerprint == "github:99"
    assert "Detailed notes" in candidate.context
    search_call = client.calls[0][2]
    assert search_call["params"]["q"] == "created:>2026-08-01 stars:5..200"
    assert search_call["params"]["sort"] == "updated"
    readme_call = client.calls[1][2]
    assert readme_call["headers"]["Accept"] == "application/vnd.github.raw+json"
    assert readme_call["headers"]["Authorization"] == "Bearer token"


def test_reddit_reports_one_subreddit_failure_and_keeps_other_results():
    good_url = "https://www.reddit.com/r/opensource/new.json"
    bad_url = "https://www.reddit.com/r/webdev/new.json"
    client = StubHttp(
        json_by_url={
            good_url: {
                "data": {
                    "children": [
                        {
                            "data": {
                                "id": "abc",
                                "created_utc": SINCE.timestamp() + 60,
                                "title": "I built a tactile debugger",
                                "author": "builder",
                                "permalink": "/r/opensource/comments/abc/demo/",
                                "url_overridden_by_dest": "https://github.com/builder/demo",
                                "selftext": "Build notes",
                            }
                        }
                    ]
                }
            }
        },
        errors={bad_url},
    )
    result = RedditSource(client, subreddits=["opensource", "webdev"]).fetch(SINCE)
    assert [candidate.fingerprint for candidate in result.candidates] == ["reddit:abc"]
    assert result.candidates[0].source_family == "reddit"
    assert result.errors == ["Reddit r/webdev: blocked"]
    assert "casting-director/1.0" in client.calls[0][2]["headers"]["User-Agent"]


RSS = """<?xml version="1.0"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
  <item>
    <title>Build a robot camera</title>
    <link>https://example.test/robot</link>
    <guid>robot-1</guid>
    <dc:creator>Maker One</dc:creator>
    <pubDate>Sun, 02 Aug 2026 12:00:00 +0000</pubDate>
    <description><![CDATA[<p>A workshop build.</p>]]></description>
  </item>
</channel></rss>"""


def test_wider_net_rss_connectors_set_distinct_source_families():
    client = StubHttp(
        text_by_url={
            HackadaySource.endpoint: RSS,
            ItchSource.endpoint: RSS.replace("robot camera", "game jam").replace("robot-1", "game-1"),
        }
    )
    hackaday = HackadaySource(client).fetch(SINCE).candidates[0]
    itch = ItchSource(client).fetch(SINCE).candidates[0]
    assert hackaday.source_family == "hackaday"
    assert itch.source_family == "itch.io"
    assert hackaday.name == "Maker One"
    assert hackaday.context == "A workshop build."


def test_authorless_feed_item_is_dropped_instead_of_using_its_title_as_a_name():
    authorless = RSS.replace("<dc:creator>Maker One</dc:creator>", "")

    candidates = parse_rss(
        authorless,
        since=SINCE,
        source="generic",
        source_family="generic",
    )

    assert candidates == []


def test_itch_uses_the_real_account_subdomain_when_feed_has_no_author():
    authorless = (
        RSS.replace("<dc:creator>Maker One</dc:creator>", "")
        .replace("https://example.test/robot", "https://maker-one.itch.io/robot")
    )

    candidates = parse_rss(
        authorless,
        since=SINCE,
        source="itch.io",
        source_family="itch.io",
        author_from_link=itch_creator_from_link,
    )

    assert len(candidates) == 1
    assert candidates[0].name == "maker-one"
    assert candidates[0].handle == "maker-one"


@pytest.mark.parametrize(
    "link",
    [
        "https://itch.io/game",
        "https://www.itch.io/game",
        "https://not_a_handle.itch.io/game",
        "https://bad-.itch.io/game",
        "https://foo%2ebar.itch.io/game",
        "https://nested.account.itch.io/game",
        "https://example.test/game",
    ],
)
def test_itch_rejects_links_without_a_valid_account_subdomain(link):
    assert itch_creator_from_link(link) == ""


def test_http_client_backs_off_and_final_429_isolated():
    sleeps = []
    attempts = []

    def blocked(request, timeout):
        attempts.append(request.full_url)
        raise urllib.error.HTTPError(
            request.full_url,
            429,
            "Too Many Requests",
            {"Retry-After": "0"},
            None,
        )

    client = HttpClient(max_retries=2, opener=blocked, sleeper=sleeps.append)
    result = collect_sources([HackadaySource(client)], SINCE)

    assert len(attempts) == 3
    assert sleeps == [0.0, 0.0]
    assert result.candidates == []
    assert len(result.errors) == 1
    assert result.errors[0].startswith("Hackaday: HTTP Error 429")


def test_collector_tolerates_a_failed_source():
    class Broken:
        name = "broken"

        def fetch(self, since):
            raise OSError("offline")

    class Working:
        name = "working"

        def fetch(self, since):
            return SourceFetch(errors=["working: partial warning"])

    result = collect_sources([Broken(), Working()], SINCE)
    assert result.errors == ["broken: offline", "working: partial warning"]
