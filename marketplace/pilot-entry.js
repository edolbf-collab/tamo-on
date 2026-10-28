(() => {
  "use strict";
  const endpoint = "https://owybghlwcohfyapvsfdo.supabase.co/functions/v1/community-marketplace-session";
  const sdk = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js";
  let community, pendingSession, timer, ownerId, failed = false, leaving = false, syncPromise, canSyncCommunity=false;
  const message = document.getElementById("pilotMessage"), retry = document.getElementById("pilotRetry");
  window.performance?.mark?.('marketplace-entry-start');
  const clearLocal = () => sessionStorage.removeItem("tamo_on_marketplace_0200_local_fallback");
  function showDiagnostics() {
    document.querySelector('.pilot-sync-bar').hidden = !canSyncCommunity;
    document.getElementById('pilotDiagnostics').hidden = !canSyncCommunity;
  }
  // Manual recovery stays inside the owner's diagnostic panel; ordinary delivery is server-side.
  async function sync() {
    if (!canSyncCommunity || failed || leaving) return false;
    if (syncPromise) return syncPromise;
    const status=document.getElementById('pilotSyncStatus');
    syncPromise=(async()=>{
      try {
        const cs=await community.auth.getSession(), ms=await window.MarketplaceBackend.client.auth.getSession();
        if(!cs.data?.session||!ms.data?.session)throw new Error('SESSION_REQUIRED');
        status.textContent='Atualizando o grupo de teste…';
        const response=await window.TamoonPilotAccess.fetchWithTimeout(window.TAMOON_CONFIG.supabaseUrl+'/functions/v1/marketplace-group-pilot',{
          method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${cs.data.session.access_token}`,
            'X-Marketplace-Authorization':`Bearer ${ms.data.session.access_token}`},body:JSON.stringify({action:'sync'})
        },30000);
        if(!response.ok)throw new Error('SYNC_FAILED');
        const result=await response.json();
        status.textContent=`${result.group_name} atualizado · ${result.updated} alteração(ões)`;
        return true;
      }catch {status.textContent='A tentativa manual não foi concluída. A atualização automática continuará tentando.';return false}
      finally{syncPromise=null}
    })();
    return syncPromise;
  }
  function fail(text = "Não foi possível carregar suas quadras e reservas. Confira a conexão e tente novamente.") {
    if (leaving) return;
    failed = true; clearInterval(timer);
    document.body.classList.add("pilot-locked");
    document.body.classList.add("pilot-failed");
    message.textContent = text; retry.hidden = false; pendingSession = null; clearLocal();
  }
  async function leave() {
    if (leaving) return;
    leaving = true; clearInterval(timer); clearLocal();
    message.textContent = "Voltando à Comunidade…";
    retry.hidden = true;
    document.body.classList.add("pilot-locked");
    document.body.classList.add("pilot-leaving");
    try {
      if (window.MarketplaceBackend?.readonlyStatus?.active) await window.MarketplaceBackend.endPartnerReadonly();
      await window.MarketplaceBackend?.client?.auth.signOut({scope:"local"});
    } catch {} finally { location.assign("/"); }
  }
  window.TamoonMarketplacePilot = Object.freeze({
    get leaving() { return leaving; },
    takeSession() { const session = pendingSession; pendingSession = null; return session; },
    ready() {
      if (!failed && !leaving) {
        document.body.classList.remove("pilot-locked");
        if(!window.performance?.getEntriesByName?.('marketplace-entry').length) {
          window.performance?.measure?.('marketplace-entry','marketplace-entry-start');
        }
      }
    }, fail, leave, sync
  });
  function script(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.async = false; tag.src = src; tag.onload = resolve; tag.onerror = () => reject(new Error("LOAD_FAILED"));
      document.body.append(tag);
    });
  }
  async function request(action, retryAuth = true) {
    const {data, error} = await community.auth.getSession();
    if (error || !data.session || (ownerId && data.session.user.id !== ownerId)) throw new Error("LOGIN_REQUIRED");
    const response = await window.TamoonPilotAccess.fetchWithTimeout(endpoint, {
      method:"POST", cache:"no-store",headers:{"Content-Type":"application/json", Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({action})
    });
    if (response.status === 401 && retryAuth) { await community.auth.refreshSession(); return request(action,false); }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error === "LEGAL_ACCEPTANCE_REQUIRED" ? result.error : response.status === 403 ? "PILOT_RESTRICTED" : "ACCESS_FAILED");
    ownerId = data.session.user.id; return result;
  }
  async function loadAssets() {
    const response = await fetch("pilot-assets.json?v=166r6", {cache:"no-store"});
    if (!response.ok) throw new Error("LOAD_FAILED");
    // The manifest normally contains one immutable bundle; async=false preserves fallback order.
    await Promise.all((await response.json()).map(script));
  }
  async function start() {
    try {
      clearLocal(); await script(sdk);
      const config = window.TAMOON_CONFIG;
      if (!config?.supabaseUrl || !config?.supabasePublishableKey) throw new Error("CONFIG_MISSING");
      community = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:false}});
      const result = await request("session");
      if (!result.session?.access_token || !result.session?.refresh_token) throw new Error("ACCESS_FAILED");
      pendingSession = result.session; canSyncCommunity = result.canSyncCommunity === true; showDiagnostics();
      message.textContent='Preparando suas quadras e reservas…';
      community.auth.onAuthStateChange((event, next) => {
        if (ownerId && (!next || next.user.id !== ownerId)) { fail("Sua sessão terminou. Volte à Comunidade para entrar novamente."); window.MarketplaceBackend?.client?.auth.signOut({scope:"local"}).catch(()=>{}); }
      });
      await Promise.all([loadAssets(), canSyncCommunity ? request("import_group") : Promise.resolve()]);
      if(failed || leaving)return;
      await window.MarketplaceBackend.init();
      const revalidate = () => request("status").then(access => {canSyncCommunity=access.canSyncCommunity===true;showDiagnostics();}).catch(() => fail());
      timer = setInterval(revalidate, 60000);
      document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && !failed && !leaving) revalidate(); });
      document.getElementById('pilotSync').addEventListener('click',sync);
    } catch (error) {
      fail(error.message === "LOGIN_REQUIRED" ? "Entre na Comunidade com sua conta autorizada para continuar."
        : error.message === "LEGAL_ACCEPTANCE_REQUIRED" ? "Volte à Comunidade e confirme os documentos de acesso antes de continuar."
        : error.message === "PILOT_RESTRICTED" ? "O marketplace está em teste privado. Sua conta ainda não tem acesso." : undefined);
    }
  }
  retry.addEventListener("click", () => location.reload());
  window.addEventListener("offline", () => fail("Conecte-se à internet para consultar quadras, reservas e pagamentos."));
  window.addEventListener("pagehide", clearLocal);
  start();
})();
