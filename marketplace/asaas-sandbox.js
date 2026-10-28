(function () {
  "use strict";

  const config = window.TAMO_ON_MARKETPLACE_CONFIG || window.TAMO_ON_PARTNERS_CONFIG || {};

  function isEnabled() {
    return Boolean(config?.asaas?.enabled && config?.asaas?.environment === "sandbox");
  }

  function buildSplit({ value, commissionRate, partnerWalletId }) {
    const rate = Math.max(0, Number(commissionRate || 0));
    if (!partnerWalletId || rate >= 100) return [];
    return [{ walletId: partnerWalletId, percentualValue: Math.max(0, 100 - rate) }];
  }

  function buildHostedCreditCardPaymentRequest({ reservation, customerId, amount, dueDate, commissionRate, partnerWalletId }) {
    return {
      method: "POST",
      path: "/v3/payments",
      body: {
        customer: customerId || "cus_preview_customer",
        billingType: "CREDIT_CARD",
        value: Number(amount || 0),
        dueDate: dueDate || new Date().toISOString().slice(0, 10),
        description: `Reserva ${reservation?.id || "Tâmo On"}`,
        externalReference: reservation?.id || "",
        split: buildSplit({ value: amount, commissionRate, partnerWalletId })
      },
      captureMode: "hosted_invoice",
      note: "Nenhum dado de cartão deve ser persistido no frontend do Tâmo On."
    };
  }

  function createPreviewCardIntent(args) {
    const request = buildHostedCreditCardPaymentRequest(args);
    return {
      id: `asaas_preview_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      provider: "ASAAS",
      route: "credit_card_asaas",
      status: "PENDING",
      billingType: "CREDIT_CARD",
      checkoutMode: "hosted",
      checkoutUrl: "preview://asaas/hosted-checkout",
      webhookExpected: true,
      webhookPath: config?.asaas?.webhookPath || "/api/webhooks/asaas",
      request
    };
  }

  function normalizeWebhook(payload) {
    const payment = payload?.payment || {};
    return {
      provider: "ASAAS",
      eventId: payload?.id || "",
      event: payload?.event || "",
      paymentId: payment?.id || "",
      reservationId: payment?.externalReference || "",
      billingType: payment?.billingType || "",
      status: payment?.status || "",
      grossValue: Number(payment?.value || 0),
      netValue: Number(payment?.netValue || 0),
      receivedAt: payload?.dateCreated || "",
      raw: payload
    };
  }

  window.AsaasSandboxAdapter = Object.freeze({
    isEnabled,
    buildSplit,
    buildHostedCreditCardPaymentRequest,
    createPreviewCardIntent,
    normalizeWebhook,
    async createCheckout() {
      throw new Error("Chamadas reais ao Asaas estão desativadas na Partners Preview 0.1.19.");
    },
    async getPaymentStatus() {
      throw new Error("Consulta real ao Asaas está desativada na Partners Preview 0.1.19.");
    }
  });
})();
