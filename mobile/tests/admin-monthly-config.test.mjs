import test from 'node:test';import assert from 'node:assert/strict';
import {monthlyEnvironment,sameSecret} from '../../integration/marketplace/asaas/functions/establishment-billing/config.mjs';
const main='00000000-0000-4000-8000-000000000001',wallet='00000000-0000-4000-8000-000000000002',child='00000000-0000-4000-8000-000000000003';
const settings={ASAAS_SANDBOX_ENABLED:'true',MARKETPLACE_STAGING_SIMULATION:'false',ASAAS_MAIN_ACCOUNT_ID:main,ASAAS_API_KEY:'main-key-only',ASAAS_SANDBOX_ACCOUNTS:JSON.stringify([{commissionWalletId:wallet,walletId:child,apiKey:'child-key-never-use'}])};
const resolve=values=>monthlyEnvironment(n=>values[n]);
test('Monthly issuer reuses only the main Sandbox credential and verified commission wallet',()=>{const e=resolve(settings);assert.equal(e('ESTABLISHMENT_CHECKOUT_ENABLED'),'true');assert.equal(e('ESTABLISHMENT_BILLING_ENVIRONMENT'),'sandbox');assert.equal(e('ESTABLISHMENT_BILLING_MAIN_API_KEY'),'main-key-only');assert.equal(e('ESTABLISHMENT_BILLING_MAIN_WALLET_ID'),wallet);assert.equal(e('ESTABLISHMENT_BALANCE_ENABLED'),undefined);});
test('Monthly issuer respects explicit opt-out and dedicated configuration',()=>{assert.equal(resolve({...settings,ESTABLISHMENT_BILLING_ENABLED:'false'})('ESTABLISHMENT_BILLING_ENABLED'),'false');assert.equal(resolve({...settings,ESTABLISHMENT_CHECKOUT_ENABLED:'false'})('ESTABLISHMENT_CHECKOUT_ENABLED'),'false');assert.equal(resolve({...settings,ESTABLISHMENT_CHECKOUT_ENABLED:'true',ESTABLISHMENT_BILLING_MAIN_API_KEY:'dedicated'})('ESTABLISHMENT_BILLING_MAIN_API_KEY'),'dedicated');});
test('Monthly issuer refuses production, contradictory wallets and missing identities',()=>{assert.throws(()=>resolve({...settings,ASAAS_BASE_URL:'https://api.asaas.com/v3'}),/SANDBOX_ONLY/);assert.throws(()=>resolve({...settings,ASAAS_MAIN_ACCOUNT_ID:''}),/NOT_CONFIGURED/);assert.throws(()=>resolve({...settings,ASAAS_SANDBOX_ACCOUNTS:'[]'}),/ISSUER_MISMATCH/);assert.throws(()=>resolve({...settings,ASAAS_SANDBOX_ACCOUNTS:JSON.stringify([{commissionWalletId:wallet,walletId:wallet}])}),/ISSUER_MISMATCH/);assert.equal(resolve({...settings,MARKETPLACE_STAGING_SIMULATION:'true'})('ESTABLISHMENT_CHECKOUT_ENABLED'),undefined);});
test('Job secret rejects empty, partial and different credentials',()=>{assert.equal(sameSecret('',''),false);assert.equal(sameSecret('a','ab'),false);assert.equal(sameSecret('abc','abd'),false);assert.equal(sameSecret('abc','abc'),true);});

test('Sandbox billing identity comes only from the verified bound subaccount',async()=>{
 const {monthlyPartner}=await import('../../integration/marketplace/asaas/functions/establishment-billing/config.mjs');
 const row={partnerId:'partner',accountId:child,walletId:main};
 const env=n=>({ESTABLISHMENT_BILLING_ENVIRONMENT:'sandbox',ESTABLISHMENT_BILLING_MAIN_WALLET_ID:wallet,ASAAS_SANDBOX_ACCOUNTS:JSON.stringify([row])})[n];
 const item={partner_id:'partner',name:'Old name',cpfCnpj:'00000000000000',amount:300};let reads=0;
 const request=async(m,p)=>{reads++;assert.equal(m,'GET');assert.equal(p,'/accounts/'+child);return {id:child,walletId:main,name:'Registered partner',cpfCnpj:'12.345.678/0001-90'};};
 const result=await monthlyPartner(item,request,env);assert.equal(result.name,'Registered partner');assert.equal(result.cpfCnpj,'12345678000190');assert.equal(result.amount,300);
 assert.equal(await monthlyPartner({...item,partner_id:'unbound'},request,env).then(x=>x.name),'Old name');assert.equal(reads,1);
 await assert.rejects(monthlyPartner(item,async()=>({id:child,walletId:wallet}),env),/PAYER_MISMATCH/);
 await assert.rejects(monthlyPartner(item,async()=>({id:main,walletId:main}),env),/PAYER_MISMATCH/);
});
