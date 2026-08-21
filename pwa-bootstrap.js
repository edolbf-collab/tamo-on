/* Tâmo On Build 145 — registro PWA antecipado, atualização coerente e diagnóstico do service worker. */
(() => {
  "use strict";

  const state = {
    secureContext: window.isSecureContext,
    serviceWorkerSupported: "serviceWorker" in navigator,
    registered: false,
    active: false,
    controlled: Boolean(navigator.serviceWorker?.controller),
    nativeInstallEventSeen: false,
    installed: window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true,
    error: null,
    swBuild: null,
    swCache: null
  };

  let registrationPromise = null;

  function requestWorkerVersion(registration = null) {
    const worker = navigator.serviceWorker?.controller || registration?.active || registration?.waiting || registration?.installing;
    worker?.postMessage?.({ type: "GET_VERSION" });
  }

  navigator.serviceWorker?.addEventListener("message", event => {
    if (event.data?.type !== "TAMOON_SW_VERSION") return;
    state.swBuild = Number(event.data.build || 0) || null;
    state.swCache = String(event.data.cache || "") || null;
  });

  function register() {
    if (registrationPromise) return registrationPromise;
    if (!state.secureContext || !state.serviceWorkerSupported) return Promise.resolve(null);
    registrationPromise = navigator.serviceWorker.register("/service-worker.js", {
      scope: "/",
      updateViaCache: "none"
    }).then(async registration => {
      state.registered = true;
      state.active = Boolean(registration.active);
      state.controlled = Boolean(navigator.serviceWorker.controller);
      await registration.update().catch(() => {});
      requestWorkerVersion(registration);
      return registration;
    }).catch(error => {
      state.error = String(error?.message || error || "Falha desconhecida");
      registrationPromise = null;
      console.warn("Falha ao registrar o service worker.", error);
      return null;
    });
    return registrationPromise;
  }

  // Observação passiva: não chama preventDefault() e não substitui o prompt do Chrome.
  window.addEventListener("beforeinstallprompt", () => {
    state.nativeInstallEventSeen = true;
  });
  window.addEventListener("appinstalled", () => {
    state.installed = true;
  });
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    state.controlled = Boolean(navigator.serviceWorker.controller);
    requestWorkerVersion();
  });

  window.tamoonPwa = {
    register,
    getRegistration: register,
    getState: () => ({ ...state })
  };

  register();
})();
