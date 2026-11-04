import {jsonResponse} from './cors.ts';
import {checkoutDiagnostic,reportCheckoutDiagnostic} from './asaas-diagnostics.ts';
import {openSandboxCheckout} from './asaas-checkout-core.mjs';
export {asaasCheckoutPayload,sandboxCheckoutUrl} from './asaas-checkout-core.mjs';

export async function openAsaasCheckout(admin: any,reservationId: string,profileId: string,retryToken: string|null=null) {
  return openSandboxCheckout(admin,reservationId,profileId,{env:(name: string)=>Deno.env.get(name),
    jsonResponse,checkoutDiagnostic,reportCheckoutDiagnostic},retryToken);
}
