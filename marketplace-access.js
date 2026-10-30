/* Shared by the Community and the private Marketplace. No access decision is persisted. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TamoonPilotAccess = api;
})(globalThis, function () {
  "use strict";

  async function fetchWithTimeout(url, options = {}, milliseconds = 15000, fetcher = fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), milliseconds);
    try { return await fetcher(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  function createMonitor({getSession, refreshSession, onChange, fetcher = fetch,
    endpoint = "https://owybghlwcohfyapvsfdo.supabase.co/functions/v1/community-marketplace-session",
    schedule = setTimeout, cancel = clearTimeout, now = Date.now}) {
    let pending = null, generation = 0, lastCheck = 0, retries = 0, timer = null, disposed = false;
    const notify = (current, state) => {
      if (!disposed && generation === current) onChange({allowed:false, canSyncCommunity:false, ...state});
    };
    const clearRetry = () => { if (timer !== null) cancel(timer); timer = null; };
    async function run(current) {
      try {
        let session = await getSession();
        if (!session?.access_token) { notify(current, {status:"signed_out"}); return; }
        const userId = session.user.id;
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetchWithTimeout(endpoint, {
            method:"POST", cache:"no-store",
            headers:{"Content-Type":"application/json", Authorization:`Bearer ${session.access_token}`},
            body:JSON.stringify({action:"status"})
          }, 15000, fetcher);
          const result = await response.json();
          if (response.status === 401 && attempt === 0 && refreshSession) {
            await refreshSession();
            session = await getSession();
            if (!session?.access_token || session.user.id !== userId) { notify(current,{status:"signed_out"}); return; }
            continue;
          }
          if ((await getSession())?.user.id !== userId) { notify(current,{status:"signed_out"}); return; }
          if (response.ok && result.allowed === true) {
            retries = 0;
            notify(current,{status:"allowed", allowed:true, canSyncCommunity:result.canSyncCommunity === true});
            return;
          }
          if (response.status === 401 || response.status === 403) {
            retries = 0;
            notify(current,{status:result.error === "LEGAL_ACCEPTANCE_REQUIRED" ? "legal_required" : "restricted"});
            return;
          }
          throw new Error("ACCESS_UNAVAILABLE");
        }
        notify(current,{status:"restricted"});
      } catch {
        notify(current,{status:"unavailable"});
        if (!disposed && generation === current && retries < 3) {
          const delay = [2000,8000,20000][retries++];
          timer = schedule(() => { timer = null; check({force:true}); }, delay);
        }
      }
    }
    function check({force = false} = {}) {
      if (disposed) return Promise.resolve();
      if (pending) return pending;
      if (!force && lastCheck && now() - lastCheck < 10000) return Promise.resolve();
      clearRetry(); lastCheck = now();
      const task = run(generation).finally(() => { if (pending === task) pending = null; });
      pending = task;
      return task;
    }
    function reset() {
      generation++; pending = null; lastCheck = 0; retries = 0; clearRetry();
      notify(generation,{status:"checking"});
    }
    return {check, reset, dispose() { disposed = true; generation++; clearRetry(); }};
  }
  async function preloadMarketplace(fetcher = fetch) {
    const response = await fetcher('/marketplace/pilot-assets.json?v=166r14', {cache:'no-store'});
    if (!response.ok) throw new Error('PREFETCH_UNAVAILABLE');
    const files = await response.json();
    await Promise.all(files.filter(path => /^assets\/pilot-[a-f0-9]{12}\.js$/.test(path)).map(path =>
      fetcher('/marketplace/' + path, {cache:'force-cache', credentials:'omit'}).then(r => { if(!r.ok)throw new Error('PREFETCH_UNAVAILABLE'); return r.arrayBuffer(); })
    ));
  }
  return Object.freeze({fetchWithTimeout, createMonitor, preloadMarketplace});
});
