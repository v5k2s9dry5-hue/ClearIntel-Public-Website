"""Read-only bounded GDACS parser probe; no report text or secrets in logs."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from intelligence_feeds import SOURCES, _download, parse_feed

if __name__ == "__main__":
    name, url, website, hosts = SOURCES["humanitarian"]
    try:
        data = _download(url)
        rows = parse_feed(data, hosts)
        print(f"Candidate GDACS parser: {len(rows)} usable reports returned")
        for severity in ("green", "amber", "red"):
            print(f"Source-rated hazard alerts ({severity}): {sum(row.get('severity') == severity for row in rows)}")
        print("Unrated publications: " + str(sum("severity" not in row for row in rows)))
    except Exception as error:
        print("Candidate GDACS parser: unavailable (" + type(error).__name__ + ")")
    for label, endpoint, hosts in (
        ('OFSI publications', 'https://www.gov.uk/government/organisations/office-of-financial-sanctions-implementation.atom', {'www.gov.uk'}),
        ('IAEA institutional news', 'https://www.iaea.org/feeds/news', {'www.iaea.org', 'iaea.org'}),
    ):
        try:
            rows = parse_feed(_download(endpoint), hosts)
            print(f'{label} candidate: {len(rows)} valid dated publications')
        except Exception as error:
            print(f'{label} candidate: unavailable ({type(error).__name__})')
