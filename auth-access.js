/* Shared by the website, Android TWA and the iOS preparation package. */
(function (global) {
  'use strict';
  const PENDING_KEY = 'tamoon-pending-identity-link';
  const MAX_AGE = 20 * 60 * 1000;
  const providers = Object.freeze({ google: 'Google', apple: 'Apple' });
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const appleIcon = '<svg viewBox="0 0 24 28" aria-hidden="true"><path d="M19.5 14.8c0-3.2 2.6-4.7 2.7-4.8-1.5-2.2-3.8-2.5-4.6-2.5-2-.2-3.9 1.2-4.9 1.2s-2.5-1.2-4.1-1.1c-2.1 0-4.1 1.3-5.2 3.1-2.2 3.8-.6 9.4 1.6 12.5 1.1 1.5 2.3 3.2 3.9 3.1 1.6-.1 2.2-1 4.2-1s2.6 1 4.3 1c1.8 0 2.8-1.5 3.8-3 1.2-1.7 1.7-3.4 1.8-3.5-.1 0-3.5-1.3-3.5-5zM16.2 5.5c.9-1.1 1.5-2.6 1.3-4.1-1.3.1-2.9.9-3.8 2-.8.9-1.5 2.5-1.3 4 1.4.1 2.9-.7 3.8-1.9z"/></svg>';

  function errorMessage(error) {
    const code = String(error?.code || error?.error_code || error?.message || '');
    if (/identity_already_exists|identity_already_linked|already.*linked|already.*registered/i.test(code)) return 'Essa forma de acesso já está vinculada a outra conta Tâmo On. Entre na conta original ou procure o suporte. Os cadastros não foram unidos.';
    if (/CANCELLED|access_denied|cancel/i.test(code)) return 'Operação cancelada. Você pode tentar novamente.';
    if (/manual_linking_disabled|provider_disabled|not enabled|AUTH_NOT_AVAILABLE/i.test(code)) return 'Essa forma de acesso ainda não está disponível. Continue usando sua opção atual.';
    if (/ACCOUNT_CHANGED/i.test(code)) return 'A conta mudou durante a vinculação. Entre novamente na conta original para continuar.';
    if (/AUTH_REQUIRED/i.test(code)) return 'Entre novamente na sua conta para vincular outra forma de acesso.';
    if (/STORAGE_UNAVAILABLE/i.test(code)) return 'Permita o armazenamento do navegador para concluir a vinculação com segurança.';
    if (/LINK_EXPIRED/i.test(code)) return 'A tentativa de vinculação expirou. Inicie novamente em Formas de acesso.';
    if (/LINK_INCOMPLETE/i.test(code)) return 'A vinculação não foi concluída. Sua forma de acesso atual continua disponível.';
    return 'Não foi possível concluir o acesso. Confira a conexão e tente novamente.';
  }
  function callbackError(location) {
    for (const params of [new URLSearchParams(location.search), new URLSearchParams((location.hash || '').replace(/^#/, ''))]) {
      if (params.has('error') || params.has('error_code')) return {code: params.get('error_code') || params.get('error')};
    }
    return null;
  }
  function androidApp() {
    return /android/i.test(global.navigator?.userAgent || '') && (
      global.Capacitor?.getPlatform?.() === 'android' ||
      global.matchMedia?.('(display-mode: standalone)')?.matches ||
      global.matchMedia?.('(display-mode: fullscreen)')?.matches ||
      /^android-app:\/\//.test(global.document?.referrer || '')
    );
  }
  function create({client, config = {}, flags = {}, native = null, storage = global.sessionStorage,
    location = global.location, history = global.history, now = Date.now} = {}) {
    const enabled = provider => provider === 'google' || (provider === 'apple' && flags.appleEnabled === true);
    let busy = false;
    const removePending = () => { try { storage.removeItem(PENDING_KEY); } catch {} };
    const readPending = () => {
      try { return JSON.parse(storage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
    };
    const assertProvider = provider => { if (!Object.prototype.hasOwnProperty.call(providers, provider) || !enabled(provider)) throw Error('AUTH_NOT_AVAILABLE'); };
    const verifiedUser = async expected => {
      const {data, error} = await client.auth.getUser();
      if (error || !data?.user) throw Error('AUTH_REQUIRED');
      if (expected && expected !== data.user.id) throw Error('ACCOUNT_CHANGED');
      return data.user;
    };
    const linked = (user, provider) => user.identities?.some(i => i.provider === provider) === true;
    const redirectTo = () => native?.isIOS ? 'br.app.tamoon://auth/callback' : config.authRedirectUrl || new URL('./', location.href).href;
    const options = provider => ({redirectTo: redirectTo(), skipBrowserRedirect: true,
      ...(provider === 'google' ? {queryParams: {prompt: 'select_account'}} : {})});
    async function navigate(url, provider, linking) {
      const target = new URL(url);
      const auth = new URL(config.supabaseUrl);
      const supabase = target.origin === auth.origin && target.pathname === '/auth/v1/authorize';
      const external = linking && ((provider === 'google' && target.hostname === 'accounts.google.com' && /^\/o\/oauth2\/(v2\/)?auth$/.test(target.pathname)) ||
        (provider === 'apple' && target.hostname === 'appleid.apple.com' && target.pathname === '/auth/authorize'));
      if (target.protocol !== 'https:' || target.username || target.password || (!supabase && !external)) throw Error('INVALID_AUTH_URL');
      if (native?.isIOS) { await native.finishOAuth(client, target.href, provider, linking); return false; }
      location.assign(target.href);
      return true;
    }
    async function completePendingLink() {
      const pending = readPending();
      if (!pending) return null;
      // The SDK completes and verifies the OAuth callback before getUser returns.
      let result;
      try {
        if (!Object.prototype.hasOwnProperty.call(providers, pending.provider) || typeof pending.userId !== 'string' || !Number.isFinite(pending.at) || now() - pending.at > MAX_AGE || pending.at > now()) throw Error('LINK_EXPIRED');
        const user = await verifiedUser(pending.userId);
        const error = callbackError(location);
        if (error) throw error;
        if (!linked(user, pending.provider)) throw Error('LINK_INCOMPLETE');
        result = {ok: true, message: `${providers[pending.provider]} vinculado à sua conta. Você já pode entrar pelas duas opções.`};
      } catch (error) {
        if (error.message === 'ACCOUNT_CHANGED') await client.auth.signOut({scope:'local'});
        result = {ok:false, message:errorMessage(error)};
      }
      removePending();
      // Remove only OAuth callback material, preserving invites and navigation.
      if (history?.replaceState) {
        const url = new URL(location.href);
        for (const key of ['code','error','error_code','error_description']) url.searchParams.delete(key);
        if (/access_token|refresh_token|error=/.test(url.hash)) url.hash = '';
        history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
      return result;
    }
    return {
      enabled, removePending, completePendingLink,
      canLink: provider => flags.linkingEnabled === true && enabled(provider),
      async list(expected) { return verifiedUser(expected); },
      async login(provider) {
        assertProvider(provider);
        if (busy) return {redirected:true};
        busy = true;
        try {
          removePending();
          if (provider === 'apple' && native?.isIOS) {
            await native.appleAuth(client, false);
            return {redirected:false};
          }
          const {data,error} = await client.auth.signInWithOAuth({provider, options:options(provider)});
          if (error) throw error;
          return {redirected:await navigate(data?.url, provider, false)};
        } finally { busy = false; }
      },
      async link(provider, expectedUserId) {
        assertProvider(provider);
        if (!this.canLink(provider)) throw Error('AUTH_NOT_AVAILABLE');
        if (!expectedUserId) throw Error('AUTH_REQUIRED');
        if (busy) return {redirected:true};
        busy = true;
        try {
          const user = await verifiedUser(expectedUserId);
          if (linked(user, provider)) return {redirected:false, ok:true, message:`${providers[provider]} já está vinculado à sua conta.`};
          const pending = JSON.stringify({provider, userId:user.id, at:now()});
          try { storage.setItem(PENDING_KEY, pending); if (storage.getItem(PENDING_KEY) !== pending) throw Error(); }
          catch { throw Error('STORAGE_UNAVAILABLE'); }
          if (provider === 'apple' && native?.isIOS) await native.appleAuth(client, true);
          else {
            // Linking MUST use the authenticated identity endpoint, never signInWithOAuth.
            const {data,error} = await client.auth.linkIdentity({provider, options:options(provider)});
            if (error) throw error;
            if (await navigate(data?.url, provider, true)) return {redirected:true};
          }
          return {redirected:false, ...await completePendingLink()};
        } catch (error) { removePending(); throw error; }
        finally { busy = false; }
      }
    };
  }

  function mountLogin(app) {
    const access = app.repo.access;
    const card = document.querySelector('.google-card');
    const google = document.getElementById('googleLoginButton');
    const message = document.getElementById('googleLoginMessage');
    if (!card || !google || !message) return;
    message.setAttribute('role','status'); message.setAttribute('aria-live','polite');
    google.dataset.authProvider = 'google';
    if (access.enabled('apple')) {
      const apple = `<button id="appleLoginButton" class="apple-login-button" type="button" data-auth-provider="apple">${appleIcon}<span>Continuar com Apple</span></button>`;
      message.insertAdjacentHTML('beforebegin', androidApp() ? `<details class="other-login"><summary>Outras formas de entrar</summary>${apple}</details>` : apple);
      message.textContent = 'Escolha uma forma de acesso para continuar.';
      card.insertAdjacentHTML('beforeend','<p class="account-link-help">Já usa o Tâmo On? Entre pela opção habitual e vincule a outra em Meu perfil → Formas de acesso.</p>');
    }
    let busy = false;
    card.querySelectorAll('[data-auth-provider]').forEach(button => button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      const buttons = [...card.querySelectorAll('[data-auth-provider]')];
      buttons.forEach(b => { b.disabled = true; });
      button.classList.add('is-loading'); button.setAttribute('aria-busy','true');
      message.classList.remove('error-text');
      message.textContent = `Abrindo o acesso seguro ${button.dataset.authProvider === 'apple' ? 'da Apple' : 'do Google'}…`;
      try {
        const result = await access.login(button.dataset.authProvider);
        if (!result.redirected) global.location.reload();
      } catch (error) { message.textContent = errorMessage(error); message.classList.add('error-text'); }
      finally { busy = false; buttons.forEach(b => { b.disabled = false; }); button.classList.remove('is-loading'); button.removeAttribute('aria-busy'); }
    }));
  }

  async function openMethods(app, notice = null) {
    const access = app.repo.access;
    const user = await access.list(app.state.profile?.id);
    const rows = Object.entries(providers).map(([provider,label]) => {
      const connected = user.identities?.some(i => i.provider === provider);
      const action = connected ? '<span class="access-connected">Vinculado</span>' : access.canLink(provider)
        ? `<button type="button" class="btn btn-secondary" data-link-provider="${provider}">Vincular ${label}</button>` : '<span class="access-pending">Disponível em breve</span>';
      return `<div class="access-method"><strong>${label}</strong>${action}</div>`;
    }).join('');
    app.modal('Formas de acesso', `<p>Use Google ou Apple para entrar na mesma conta Tâmo On.</p><div class="access-methods">${rows}</div><p class="access-help">Ao vincular, confirme o acesso à conta escolhida. Seus grupos, reservas e pagamentos permanecem nesta conta.</p><p id="accessMethodStatus" role="status" aria-live="polite"${notice?.ok === false ? ' class="error-text"' : ''}>${escape(notice?.message)}</p><div class="access-close"><button type="button" class="btn btn-secondary" id="closeAccessMethods">Fechar</button></div>`, (root, close) => {
      root.querySelector('#closeAccessMethods').onclick = close;
      let busy = false;
      const buttons = [...root.querySelectorAll('[data-link-provider]')];
      buttons.forEach(button => button.addEventListener('click', async () => {
        if (busy) return;
        busy = true; buttons.forEach(b => { b.disabled = true; });
        const status = root.querySelector('#accessMethodStatus');
        status.classList.remove('error-text');
        status.textContent = `Confirme sua conta ${providers[button.dataset.linkProvider]} para vinculá-la.`;
        try {
          const result = await access.link(button.dataset.linkProvider, user.id);
          if (!result.redirected) await openMethods(app, result);
        } catch (error) { status.textContent = errorMessage(error); status.classList.add('error-text'); }
        finally { busy = false; buttons.forEach(b => { b.disabled = false; }); }
      }));
    });
  }
  global.TamoonAuth = Object.freeze({create, mountLogin, openMethods, errorMessage, callbackError, androidApp});
})(typeof window !== 'undefined' ? window : globalThis);
