# ClearIntel Atlas — public-source intelligence dashboard

[ClearIntel Atlas](https://clearintel-public.onrender.com/) is a free, responsive global public-source research dashboard with country news briefs, sourced environmental observations, selected historical reports, saved local Replay snapshots, and a research enquiry workflow. Its headline lookup has provider limits and is not independent verification of incidents. It is NOT the private ClearIntel OSINT investigation engine. Do not upload your internal source files, API keys, local database, case information or `clearintel_gui.py` to the public repository.

## Open Atlas as a web app

Use your browser’s **Install** or **Add to Home Screen** option where available. Atlas opens in its own window and uses an internet connection for the site and its live sources.

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
# After a deployment, verify that the actual served revision matches main:
python scripts/check_production.py https://clearintel-public.onrender.com --expected-commit FULL_40_CHARACTER_GIT_SHA
```

The read-only checker validates HTTPS responses, health, canonical URLs, public country page links, sitemap consistency, the Google verification file, security headers and dashboard HTML markers. It also checks the minimal public `/api/build` revision response; `--expected-commit` verifies the deployed Render Git SHA against a full commit from the `main` branch, failing closed on a stale/missing revision. Render provides the `RENDER_GIT_COMMIT` variable automatically, so do not add deployment secrets or configure extra environment variables. Use the configured canonical public URL if it changes. It does not query live news providers, determine Google's indexing status, or replace browser and security testing. Exit code 1 means at least one public check failed; a connection failure may indicate a cold start or network issue. Run again manually after deployment rather than polling aggressively.

## Optional English country headline translation

Country headline translation works across devices when a dedicated Azure Translator **F0 (free)** resource is configured. Set `AZURE_TRANSLATOR_F0_KEY` and, if required for the resource, `AZURE_TRANSLATOR_REGION` in the hosting service's private environment settings. Never commit keys, use a paid-tier key, or upgrade without the owner's approval. With no key, no requests are sent to Azure; the country card offers a user-initiated Google Translate link instead. Clicking that link sends the public headline to Google. Translated titles are machine translations, not independently verified claims; original titles and source URLs are retained. The server translates only existing public country-news titles, uses a bounded in-memory cache and conservative daily budget, and backs off on failures. The local budget resets on restart and is not a billing guarantee; use a dedicated F0 resource and monitor provider quotas. No general translation endpoint is exposed.
