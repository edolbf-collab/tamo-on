(() => {
  "use strict";
  const endpoint = "https://owybghlwcohfyapvsfdo.supabase.co/functions/v1/community-marketplace-session";
  const sdk = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js";
  let community, pendingSession, timer, ownerId, loaded = false, failed = false;
  const message = document.getElementById("pilotMessage");
  const retry = document.getElementById("pilotRetry");
  const clearLocal = () => sessionStorage.removeItem("tamo_on_marketplace_0200_local_fallback");
  function fail(text = "Não foi possível validar o acesso ou carregar os dados. Volte à Comunidade ou tente novamente.") {
    failed = true;
    document.body.classList.add("pilot-locked");
    message.textContent = text;
    retry.hidden = false;
    pendingSession = null;
    clearLocal();
  }
  async function leave() {
    clearInterval(timer);
    clearLocal();
    try { await window.MarketplaceBackend?.client?.auth.signOut({scope:"local"}); } catch {}
    location.assign("/");
  }
  window.TamoonMarketplacePilot = Object.freeze({
    takeSession() { const session = pendingSession; pendingSession = null; return session; },
    ready() { if (!failed) document.body.classList.remove("pilot-locked"); },
    fail, leave
  });
  function script(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src; tag.onload = resolve; tag.onerror = () => reject(new Error("LOAD_FAILED"));
      document.body.append(tag);
    });
  }
  async function request(action) {
    const {data, error} = await community.auth.getSession();
    if (error || !data.session || (ownerId && data.session.user.id !== ownerId)) throw new Error("LOGIN_REQUIRED");
    const response = await fetch(endpoint, {
      method:"POST", cache:"no-store", signal: AbortSignal.timeout(15000),
      headers:{"Content-Type":"application/json", Authorization:`Bearer ${data.session.access_token}`},
      body:JSON.stringify({action})
    });
    if (!response.ok) throw new Error(response.status === 403 ? "PILOT_RESTRICTED" : "ACCESS_FAILED");
    ownerId = data.session.user.id;
    return response.json();
  }
  async function start() {
    try {
      clearLocal();
      await script(sdk);
      const config = window.TAMOON_CONFIG;
      if (!config?.supabaseUrl || !config?.supabasePublishableKey) throw new Error("CONFIG_MISSING");
      community = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:false}
      });
      const result = await request("session");
      if (!result.session?.access_token || !result.session?.refresh_token) throw new Error("ACCESS_FAILED");
      pendingSession = result.session;
      community.auth.onAuthStateChange((event, next) => {
        if (loaded && (!next || next.user.id !== ownerId)) { fail("Sua sessão da Comunidade terminou. Entre novamente para continuar."); window.MarketplaceBackend?.client?.auth.signOut({scope:"local"}).catch(()=>{}); }
      });
      const response = await fetch("pilot-assets.json?v=166", {cache:"no-store"});
      if (!response.ok) throw new Error("LOAD_FAILED");
      for (const src of await response.json()) await script(src);
      loaded = true;
      await window.MarketplaceBackend.init();
      timer = setInterval(() => request("status").catch(() => fail()), 60000);
      document.getElementById("pilotBack").addEventListener("click", event => { event.preventDefault(); leave(); });
    } catch (error) {
      const text = error.message === "LOGIN_REQUIRED" ? "Entre na Comunidade com sua conta autorizada e abra Onde jogar."
        : error.message === "PILOT_RESTRICTED" ? "O marketplace está em teste privado. Sua conta ainda não tem acesso."
        : undefined;
      fail(text);
    }
  }
  retry.addEventListener("click", () => location.reload());
  window.addEventListener("offline", () => fail("Os testes precisam de internet. Reconecte e tente novamente."));
  window.addEventListener("pagehide", clearLocal);
  start();
})();
