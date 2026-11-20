# ClearIntel development checkpoint — 20 November 2026

## Where work stopped
- Latest merged pull request: #12, "Add interactive UTC timelines for live globe reports".
- PR #12 was merged into `main` at commit `3d6068f26c820a6fefcd3ff71a10a7329a937081`.
- Timeline supports two-hour UTC buckets in the 24-hour feed view and daily buckets in the seven-day feed view. Selecting a bucket filters both the live feed and the map; "All times" clears the selection.
- Timeline integration passed nine source-level checks; full browser/application checks and live Render deployment verification remain outstanding.

## Recently completed website work
- PR #4: Globe drag follows mouse/finger direction.
- PR #6: NASA EONET wildfire layer.
- PR #7: UK coastline detail and UK shortcut.
- PR #8: Globe-centred navy/cyan responsive dashboard.
- PR #9: CL monogram in the top-left header.
- PR #10: Worldwide Natural Earth coastline/border details, zoom levels, and lazy detailed-map loading.
- PR #11: Client-side public news PDF report export with selected findings, links, timestamps and optional local notes.
- PR #12: Interactive event timeline.

## Product direction
- A public, professional, easy-to-understand ClearIntel 3.0 intelligence site with a live globe, regularly refreshed source-linked feeds, and clear indication of time, data age and uncertainty.
- Visual direction: dark navy/cyan research dashboard; prominent globe; uncluttered navigation; working help text; mobile-friendly layout.
- Prioritise the rest of the website and useful intelligence features before creating customer accounts, paywalls or paid tiers.
- Public website repository is deliberately separate from the user's private ClearIntel OSINT CLI in Ubuntu/WSL. Do not transfer private investigation files, credentials, client cases, or API keys into the public repository.

## Next development tasks
1. Verify that the latest `main` commits are live on Render and test timeline, map, PDF, mobile navigation and feed/source links in a browser.
2. Improve event filter usability and clear evidence summaries, with source timestamps and explicit caveats for unverified incidents.
3. Expand genuinely useful, lawfully sourced, reliably refreshed data layers without claiming every event is real-time or verified.
4. Continue improving worldwide map clarity and frontend performance, especially on lower-powered devices.
5. Defer authentication, customer storage, subscriptions and payments until the core public website is complete.

## Local Ubuntu reminder
- GitHub merges above are already saved; local Ubuntu CLI is a separate project.
- In a terminal with no editor open, `sync && exit` flushes pending disk writes and exits the current shell. First save any open editor; first stop any foreground server with Ctrl+C.
