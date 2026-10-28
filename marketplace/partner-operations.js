/* Regras de apresentacao. A autorizacao efetiva e conferida novamente pelo servidor. */
(function(root){
  'use strict';
  const pages={overview:[],agenda:['manage_schedule'],reservations:['manage_schedule'],spaces:['manage_spaces'],clients:['manage_schedule'],team:['manage_team'],vouchers:['manage_finance'],finance:['manage_finance'],registration:['manage_profile','manage_documents']};
  const actions={
    manage_spaces:['new-space','edit-space','toggle-space'],
    manage_team:['new-team-member','edit-team-member','toggle-team-member'],
    manage_documents:['open-partner-document','upload-partner-document','delete-partner-document','add-document','edit-document','remove-document','remove-partner-document'],
    manage_profile:['upload-partner-photos','delete-partner-photo','remove-partner-photo','set-partner-favorite-photo','request-partner-closure','favorite-partner-photo','edit-company-data','edit-responsible-data','edit-address-data','edit-contract-data','edit-fiscal-data','edit-payment-integrations','edit-bank-data','onboarding-open-dossier','partner-application-details'],
    manage_finance:['create-partner-promotion','toggle-promotion','delete-promotion','export-partner-finance','export-finance-movements','register-external-receipt','partner-settle-monthly-share','settle-monthly-share','reassign-cancellation-voucher','finance-period-prev','finance-period-next','finance-period-today','finance-period-all','finance-period-retry','export-reservation-payment-audit'],
    manage_schedule:['new-availability','edit-availability','delete-availability','delete-selected-availability','block-availability','unblock-availability','toggle-all-availability','toggle-availability-selection','cancel-backend-partner-reservation','cancel-paid-partner-reservation','partner-reservation-status','propose-monthly-request','close-monthly-request','message-monthly-request','partner-cancel-occurrence','propose-occurrence-transfer','occurrence-transfer-availability','send-occurrence-transfer-message','decline-occurrence-transfer','new-client','edit-client','client-details','new-partner-reservation','new-schedule','edit-schedule','delete-schedule','block-schedule','unblock-schedule','partner-schedule-date','schedule-slot-details','export-partner-reservations','partner-reservation-details','open-reservation-chat','open-monthly-request','open-occurrence-transfer-chat']
  };
  function allowed(context,permission){
    if(!context.official)return true;
    if(context.pending||!context.connected)return false;
    if(context.preview)return true;
    const m=context.member;
    return Boolean(m?.active&&(m.roleKey==='owner'||m.role==='owner'||m.permissions?.[permission]===true));
  }
  function pageAllowed(page,check){return page==='overview'||Boolean(pages[page]?.some(check));}
  function actionPermission(action){
    for(const [permission,names] of Object.entries(actions))if(names.includes(action))return permission;
    if(action.startsWith('registration-')||action.startsWith('onboarding-'))return 'manage_profile';
    if(/^(new|edit|delete|block|unblock|remove|create)-.*(slot|schedule)/.test(action))return 'manage_schedule';
    return null;
  }
  function voucherUsed(voucher){
    const status=String(voucher.status||'').toLowerCase();
    const remaining=Number(voucher.remainingValue??voucher.remaining_value??voucher.value??NaN);
    return ['used','consumed','fully_used'].includes(status)||(Number.isFinite(remaining)&&remaining<=0&&Number(voucher.usedValue??voucher.used_value??voucher.usedCount??0)>0);
  }
  function promotionUsed(promo){
    if(['used','consumed','fully_used'].includes(String(promo.status||'').toLowerCase()))return true;
    if(promo.singleUse&&Number(promo.usedCount||0)>0)return true;
    const limit=Number(promo.maxUses??promo.max_uses??0);
    return limit>0&&Number(promo.usedCount||0)>=limit;
  }
  root.MarketplacePartnerOperations=Object.freeze({pages,allowed,pageAllowed,actionPermission,voucherUsed,promotionUsed});
})(typeof window!=='undefined'?window:globalThis);
