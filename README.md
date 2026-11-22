# ClearIntel — public website (safe separation)

Responsive public website with a limited, live *news-headline lookup* and a research enquiry workflow. It is NOT the private ClearIntel OSINT investigation engine. Do not upload your internal source files, API keys, local database, case information or `clearintel_gui.py` to the public repository.

## Development roadmap

See [the active 22 November 2026 roadmap](docs/ROADMAP_2026-11-22.md), including the approved Intelligence Replay feature and its free-first, privacy-preserving milestones.

## Test locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m unittest discover -p 'test_*.py' -v
uvicorn main:app --host 127.0.0.1 --port 8080
```
Open `http://127.0.0.1:8080`.

## Deploy to Render

1. Create a **new, separate GitHub repository** and push *only* this directory (not your ClearIntel investigation directory).
2. Render > New > Web Service; connect this public repository. Deploy using the `render.yaml` blueprint or the commands inside it.
3. Open the Render-generated `*.onrender.com` URL. Test a news search. External provider responsiveness and quotas vary.
4. After buying a domain, add it in Render's domain settings, configure DNS and set `PUBLIC_BASE_URL` to `https://yourdomain.example`.
5. Verify your domain in Google Search Console and submit `https://yourdomain.example/sitemap.xml`. Indexing is not guaranteed or immediate.

**Important:** Only the public website is deployed. The local private research tool and saved case reports are not connected. If you later want registered customers to run full investigations, build a separate authenticated service with per-user isolation, rate limits, abuse controls, audit logs and secure background workers.

## About news searches

News is gathered live from GDELT and Google News RSS using bounded provider requests. The application returns recent feed timestamps (Google News publication or GDELT first-seen time) and conservative headline matches. **These results are not verified records of incidents.** A recently indexed article may describe an older incident. If sources are unavailable, the API returns an explicit error rather than inventing results. This code has been unit-tested with simulated provider responses but has not been tested against live providers in the offline build environment.

## Privacy and limitations

- No cookies or analytics included.
- Public search queries are processed transiently by the server and transmitted to news providers. Do not search for sensitive personal information.
- Anonymous requests are rate-limited in memory. For higher traffic, add managed rate limits / CDN protections.
- Public enquiry uses `mailto:`: it opens the visitor's default email client and does not silently submit or store data.
- No private ClearIntel modules, files, API tokens, Python subprocess execution or report downloads exposed to website visitors.
- Static pages are indexable after publishing; Google visibility requires discovery and is not guaranteed.

## Verify the deployed public site

From the repository root, run:

```bash
python scripts/check_production.py https://clearintel-public.onrender.com
```

The read-only checker validates HTTPS responses, health, canonical URLs, public country page links, sitemap consistency, the Google verification file, security headers and dashboard HTML markers. Use the configured canonical public URL if it changes. It does not query live news providers, determine Google's indexing status, prove the deployed Git commit, or replace browser and security testing. Exit code 1 means at least one public check failed; a connection failure may indicate a cold start or network issue. Run again manually after deployment rather than polling aggressively.
