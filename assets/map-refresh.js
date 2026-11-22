'use strict';
window.ClearIntelMapRefresh = {
  async fetch(endpoint) {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),12000);
    try {
      const response = await fetch(endpoint,{cache:'no-store',signal:controller.signal});
      return {ok:response.ok,status:response.status,headers:response.headers,
        data:response.ok?await response.json():null};
    } finally { clearTimeout(timeout); }
  },
  retryAt(response, now=Date.now()) {
    const raw = response.headers.get('Retry-After');
    if (!raw) return now+30000;
    const numeric = Number(raw);
    const due = Number.isFinite(numeric) ? now+numeric*1000 : Date.parse(raw);
    return Number.isFinite(due) ? Math.max(now+30000,due) : now+30000;
  }
};
