import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../../marketplace/frontend/backend/marketplace-backend.js',import.meta.url),'utf8');
const rpcSource=source.slice(source.indexOf('  async function rpc('),source.indexOf('  // Keep the database pool'));

function fixture(code,missingName) {
  const calls=[];
  const error={code,message:'Could not find the function public.'+missingName+'(p_id) in the schema cache'};
  const legacy=name=>args=>{calls.push({name,args});return {reservation_id:'old'};};
  const context={readonlyRpcNames:new Set(),assertWritable:async()=>{},requireClient:()=>({rpc:async()=>({error})}),
    createReservationPrebooking:legacy('single'),contractDirectMonthlyPrebooking:legacy('monthly'),
    activateMonthlyCyclePrebooking:legacy('cycle')};
  vm.runInNewContext(rpcSource,context);
  return {calls,rpc:context.rpc,error};
}
test('Web can use the prior booking API when the new read and booking endpoints are absent',async()=>{
  const read=fixture('PGRST202','reservation_receipt_mode');
  assert.equal(await read.rpc('reservation_receipt_mode',{}),'legacy');
  for(const [name,monthly,target] of [['book_with_receipt_mode',false,'single'],['book_with_receipt_mode',true,'monthly'],['book_cycle_with_receipt_mode',true,'cycle']]){
    const f=fixture('PGRST202',name);
    await f.rpc(name,{p_expected:'legacy',p_monthly:monthly,p_accepted:true});
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,target);assert.equal(f.calls[0].args.policyAccepted,true);
  }
});
test('Timeout, permission errors, and bookings reviewed under the new terms never retry the old endpoint',async()=>{
  const name='book_with_receipt_mode';
  for(const [code,mode,missing] of [['57014','legacy',name],['42501','legacy',name],['PGRST202','external',name],['PGRST202','asaas',name],['PGRST202','legacy','something_else']]){
    const f=fixture(code,missing);
    await assert.rejects(f.rpc(name,{p_expected:mode}),error=>error===f.error);assert.equal(f.calls.length,0);
  }
});
