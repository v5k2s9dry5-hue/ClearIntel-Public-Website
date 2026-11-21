# ClearIntel public website — checkpoint for Tuesday, 24 November 2026

Recorded: Saturday, 21 November 2026 (UTC).

## Confirmed save state
- Public website repository: `v5k2s9dry5-hue/ClearIntel-Public-Website`; default branch `main`.
- Verified main application head before writing this checkpoint: `6e08c96c83497b623757db5d19859f1f51b6ab1f`.
- GitHub automated tests for that head were **successful**. Previous changes are preserved in Git history and merged PRs; saving this document adds one more documentation-only commit.
- Public site configured in `render.yaml` for Render; expected web address: `https://clearintel-public.onrender.com/`. **Production deployment status and external provider results have not been independently verified** in this session.
- Relevant PRs: #23 (country changes, publisher feeds, city headline mentions, mobile tooltip) and #24 (Chromium mobile/desktop workflow tests).

## Completed on 21 November
1. Country news now ranks up to three source-linked stories per country, with national editions and country-specific publisher support. UK publisher coverage includes BBC national and regional feeds; Spanish coverage includes El País and El Mundo. These feeds may be slow, block requests, or be unavailable; never claim universal or guaranteed coverage.
2. Country briefs show story changes since the previous successfully fetched country brief **within the same browser session**. These labels reflect feed changes, not necessarily breaking news or verified events.
3. For the UK and Spain, a selected country may display extra city-centre map markers when a recent, source-linked headline explicitly names a supported city. Pins represent **headline mentions only**, not confirmed event locations or live military movements. This is currently a finite UK/Spain city alias list, **not** worldwide street-level news mapping.
4. ClearIntel accepts two-character searches such as `UK` and `US`.
5. Mobile help popovers were changed to appear inline on small screens so they do not obscure the search field or button; desktop popovers are kept within viewport boundaries. Final browser smoke tests passed in 390px and 1280px viewport configurations.
6. Automated GitHub Actions checks run Python news/API fixtures, JavaScript syntax, country-change tests and real Chromium workflows. Smoke test uses fixture headlines to check globe country selection, responsive tooltip, news search and PDF generation/download. They **do not** confirm real news feed availability or Render production status.
7. Existing map layers remain: earthquakes (USGS), wildfires (NASA EONET), ISS position, country headlines and source-linked **historical reports** on military aviation/naval activity. Never label the historical military archive as real-time vessel or aircraft location tracking.
8. UI direction: simple responsive dark navy/cyan intelligence dashboard with large interactive globe and dated, source-linked reporting. Existing PDF export and timeline maintained. Authentication, payments and customer accounts deferred until main public product is sound.

## Safety and separation
- This repository is PUBLIC. Do not commit local Ubuntu investigation engine, client data, evidence, personally identifiable case files, tokens, API keys, `.env` files, or secret configuration.
- Private ClearIntel CLI lives separately in Ubuntu/WSL. No files were modified, backed up, or verified inside that local environment during this GitHub session.
- Public site exposes ordinary published data/news research, not private OSINT CLI execution. The existing news endpoints have input validation, in-memory rate limiting and bounded feed requests. No blanket security guarantee: a production security review, dependency vulnerability monitoring and environment-secret review are still appropriate.
- Git history provides a saved copy of the public site; **a separate offsite backup of the private local project has not been confirmed**.

## Tuesday resume plan
1. Inspect `main` latest commit, GitHub Actions results and Render's latest deployment; open the public website and verify actual deployed version, if access allows.
2. Smoke-test the LIVE production website on iPhone-sized and desktop viewports: tooltip, `UK` query, Spain/UK leading stories, publisher links, globe navigation, city-mention pins, timestamps, and PDF download. Distinguish real provider outages from code bugs.
3. Review actual country coverage and source relevance with UK, Spain and other regions; avoid unsupported global 24/7 promises. Build robust fallbacks and clear source freshness markers.
4. Continue improving usable source-linked worldwide coverage, accessible mobile UI and performance; plan any next data layers around provider policy and public safety.
5. Separately check private Ubuntu CLI backups locally before making any private-system changes.

## Useful links
- Public repository: https://github.com/v5k2s9dry5-hue/ClearIntel-Public-Website
- Main website update: https://github.com/v5k2s9dry5-hue/ClearIntel-Public-Website/pull/23
- Browser tests: https://github.com/v5k2s9dry5-hue/ClearIntel-Public-Website/pull/24
- Successful GitHub CI for head before documentation commit: https://github.com/v5k2s9dry5-hue/ClearIntel-Public-Website/actions/runs/44904188096

To resume: Ask to continue ClearIntel from the 21 November GitHub checkpoint, and start with production deployment verification.
