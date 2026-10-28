const TAMO_ON_MARKETPLACE_CONFIG_VALUE = Object.freeze({
  appName: "Marketplace Tâmo On",
  version: "0.2.0",
  environment: "marketplace_staging",
  realMoney: false,
  payments: {
    routingEnabled: true,
    defaultMethod: "pix_direct_partner",
    bankPix: {
      enabled: true,
      networkEnabled: false,
      webhookFunction: "bank-pix-webhook",
      supportedAdapters: ["SICOOB", "SICREDI", "BB", "INTER", "GENERIC_MANUAL"]
    }
  },
  asaas: {
    enabled: true,
    environment: "sandbox",
    checkoutMode: "hosted",
    cardEnabled: true,
    splitPrepared: true,
    splitEnabled: false,
    webhookFunction: "asaas-webhook"
  },
  backend: {
    type: "supabase",
    staging: true,
    rls: true,
    realtime: true,
    storage: true,
    localFallback: false
  },
  features: {
    venueDiscovery: true,
    reservations: true,
    partnerPortal: true,
    adminPortal: true,
    partnerOnboarding: true,
    unifiedSchedule: true,
    monthlyReservations: true,
    vouchers: true,
    reservationChat: true,
    venueGallery: true,
    photoAutoContrast: true,
    groupLinkedReservations: true,
    pixSplit: true,
    multiBankPixAdapters: true,
    asaasCreditCardHostedCheckout: true,
    productionWrites: false
  }
});
window.TAMO_ON_MARKETPLACE_CONFIG = TAMO_ON_MARKETPLACE_CONFIG_VALUE;
// Alias temporário para módulos herdados da linha 0.1.x. Remover após a migração completa do frontend.
window.TAMO_ON_PARTNERS_CONFIG = TAMO_ON_MARKETPLACE_CONFIG_VALUE;
