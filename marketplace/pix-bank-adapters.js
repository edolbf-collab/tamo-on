(function () {
  "use strict";

  const config = window.TAMO_ON_MARKETPLACE_CONFIG || window.TAMO_ON_PARTNERS_CONFIG || {};

  const PROVIDERS = Object.freeze({
    SICOOB: { id: "SICOOB", label: "Sicoob", mode: "api", capabilities: ["dynamic_qr", "txid", "webhook", "refund"] },
    SICREDI: { id: "SICREDI", label: "Sicredi", mode: "api", capabilities: ["dynamic_qr", "txid", "webhook", "refund"] },
    BB: { id: "BB", label: "Banco do Brasil", mode: "api", capabilities: ["dynamic_qr", "txid", "webhook", "refund"] },
    INTER: { id: "INTER", label: "Banco Inter", mode: "api", capabilities: ["dynamic_qr", "txid", "webhook", "refund"] },
    GENERIC_MANUAL: { id: "GENERIC_MANUAL", label: "Outro banco · confirmação manual", mode: "manual", capabilities: ["pix_key", "manual_confirmation"] }
  });

  function provider(providerId) {
    return PROVIDERS[providerId] || PROVIDERS.GENERIC_MANUAL;
  }

  function sanitizeReference(value) {
    return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 35) || `TAMO${Date.now()}`;
  }

  function buildNormalizedCharge({ providerId, partner, reservation, amount, memberId = "", dueAt = "" }) {
    const p = provider(providerId);
    const reference = sanitizeReference(`${reservation?.id || "RES"}-${memberId || "TOTAL"}`);
    return {
      provider: p.id,
      providerLabel: p.label,
      mode: p.mode,
      amount: Number(amount || 0),
      currency: "BRL",
      txid: reference,
      externalReference: reservation?.id || reference,
      memberId,
      dueAt,
      creditor: {
        partnerId: partner?.venueId || "",
        name: partner?.tradeName || "",
        bank: partner?.bank || p.label,
        pixKey: partner?.pixKey || ""
      },
      capabilities: [...p.capabilities]
    };
  }

  function createPreviewCharge(args) {
    const normalized = buildNormalizedCharge(args);
    const id = `pix_preview_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    if (normalized.mode === "manual") {
      return {
        id,
        provider: normalized.provider,
        status: "MANUAL_CONFIRMATION_REQUIRED",
        route: "pix_direct_partner_manual",
        normalized,
        qrPayload: "",
        qrCodeAvailable: false,
        webhookExpected: false
      };
    }
    return {
      id,
      provider: normalized.provider,
      status: "PENDING",
      route: "pix_direct_partner_api",
      normalized,
      qrPayload: `PREVIEW-PIX-${normalized.provider}-${normalized.txid}-${normalized.amount.toFixed(2)}`,
      qrCodeAvailable: true,
      webhookExpected: true,
      webhookPath: `${config?.payments?.bankPix?.webhookBasePath || "/api/webhooks/pix"}/${normalized.provider.toLowerCase()}`
    };
  }

  function normalizeWebhook(providerId, payload) {
    const p = provider(providerId);
    const pix = Array.isArray(payload?.pix) ? payload.pix[0] : payload?.pix || payload || {};
    return {
      provider: p.id,
      eventId: payload?.id || payload?.eventId || pix?.endToEndId || "",
      event: "PIX_RECEIVED",
      txid: pix?.txid || payload?.txid || payload?.externalReference || "",
      endToEndId: pix?.endToEndId || payload?.endToEndId || payload?.e2eId || "",
      amount: Number(pix?.valor || pix?.value || payload?.value || payload?.amount || 0),
      receivedAt: pix?.horario || payload?.dateCreated || payload?.receivedAt || "",
      raw: payload
    };
  }

  window.TamoOnBankPix = Object.freeze({
    providers: PROVIDERS,
    listProviders() { return Object.values(PROVIDERS); },
    provider,
    supportsAutomaticReconciliation(providerId) { return provider(providerId).mode === "api"; },
    buildNormalizedCharge,
    createPreviewCharge,
    normalizeWebhook
  });
})();
