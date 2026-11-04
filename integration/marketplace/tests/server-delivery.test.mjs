import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler} from '../../community/functions/community-marketplace-delivery/handler.mjs';
function fixture(result={data:{ok:true,updated:0}}){const calls=[];return {calls,handle:createDeliveryHandler({apply:async args=>{calls.push(args);return result}})}}
const payload={p_payload:'{"nonce":"test"}',p_signature:'a'.repeat(64)};
const request=(body=payload,headers={})=>new Request('https://delivery.test',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('delivery delegates signature verification and never accepts caller actor fields',async()=>{const f=fixture();assert.equal((await f.handle(request({...payload,actor:'forged'}))).status,200);assert.deepEqual(f.calls,[payload])});
test('browser origins and non-POST requests cannot invoke the relay',async()=>{const f=fixture();assert.equal((await f.handle(request(payload,{Origin:'https://app.tamoon.app.br'}))).status,403);assert.equal((await f.handle(new Request('https://delivery.test'))).status,405);assert.equal(f.calls.length,0)});
test('oversized and malformed requests stop before database access',async()=>{const f=fixture();assert.equal((await f.handle(request({p_payload:1,p_signature:'bad'}))).status,400);assert.equal((await f.handle(request({...payload,p_payload:'x'.repeat(1200001)}))).status,413);assert.equal(f.calls.length,0)});
test('invalid MAC is denied and transient delivery errors can retry',async()=>{assert.equal((await fixture({error:{code:'PT403'}}).handle(request())).status,403);assert.equal((await fixture({error:{code:'57014'}}).handle(request())).status,503)});
