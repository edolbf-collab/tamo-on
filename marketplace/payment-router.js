(function () {
  "use strict";

  const METHODS = Object.freeze({
    PIX_DIRECT_PARTNER: "pix_direct_partner",
    CREDIT_CARD_ASAAS: "credit_card_asaas",
    VOUCHER: "voucher"
  });

  function methodLabel(method) {
    const labels = {
      [METHODS.PIX_DIRECT_PARTNER]: "Pix",
      [METHODS.CREDIT_CARD_ASAAS]: "Cartão de crédito · Asaas",
      [METHODS.VOUCHER]: "Voucher integral"
    };
    return labels[method] || method;
  }

  function createPreviewIntent({ method, reservation, partner, amount, commissionRate = 0 }) {
    if (Number(amount || 0) <= 0) {
      return { id: `voucher_${Date.now()}`, provider: "TAMO_ON", route: METHODS.VOUCHER, status: "SETTLED", amount: 0, webhookExpected: false };
    }
    if (method === METHODS.CREDIT_CARD_ASAAS) {
      return window.AsaasSandboxAdapter.createPreviewCardIntent({
        reservation,
        customerId: reservation?.asaasCustomerId || "cus_preview_customer",
        amount,
        commissionRate,
        partnerWalletId: partner?.asaasWalletId || "",
        dueDate: new Date().toISOString().slice(0, 10)
      });
    }
    return window.TamoOnBankPix.createPreviewCharge({
      providerId: partner?.bankProviderId || "GENERIC_MANUAL",
      partner,
      reservation,
      amount
    });
  }

  function normalizeWebhook(provider, payload) {
    if (String(provider).toUpperCase() === "ASAAS") return window.AsaasSandboxAdapter.normalizeWebhook(payload);
    return window.TamoOnBankPix.normalizeWebhook(provider, payload);
  }

  window.TamoOnPaymentRouter = Object.freeze({ METHODS, methodLabel, createPreviewIntent, normalizeWebhook });
})();
