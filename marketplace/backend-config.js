/**
 * Marketplace Tâmo On 0.2.0 — configuração do frontend para HOMOLOGAÇÃO.
 *
 * Preencha SOMENTE URL + chave publicável do projeto Supabase de staging.
 * Nunca coloque service_role/secret key, API key Asaas ou credenciais bancárias aqui.
 */
window.TAMO_ON_MARKETPLACE_BACKEND_CONFIG = Object.freeze({
  enabled: true,
  environment: "staging",
  supabaseUrl: "https://owybghlwcohfyapvsfdo.supabase.co",
  supabasePublishableKey: "sb_publishable_wuVVHMVrCI1MplRzcezIfA_HHTXooiE",
  realtime: true,
  // The server uses Asaas Sandbox; its legacy local payment simulator is disabled.
  simulationPayments: false,
  asaasSandboxCheckout: true,
  auth: {
    google: true,
    emailPassword: true
  },
  functions: {
    bootstrap: "marketplace-bootstrap",
    paymentRouter: "payment-router",
    paymentSimulator: "payment-simulator",
    pixChargeRouter: "pix-charge-router",
    health: "backend-health"
  }
});
