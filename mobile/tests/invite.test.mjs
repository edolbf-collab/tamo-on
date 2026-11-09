import test from 'node:test';
import assert from 'node:assert/strict';
import {inviteCode, createInviteReceiver} from '../src/invite.mjs';
const url='br.app.tamoon://invite?code=A1B2C3D4';
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
function fixture(){
 const calls=[],storage=memory(),session=memory();
 const app={ready:true,state:{profile:{id:'member'}},openJoinGroupModal:code=>calls.push(code)};
 const options={storage,session,getApp:()=>app,location:{protocol:'capacitor:',host:'localhost',pathname:'/',assign:value=>calls.push(value)}};
 return {calls,storage,session,app,options,receive:createInviteReceiver(options)};
}
test('Only the invitation scheme and a single valid group code are accepted',()=>{
 assert.equal(inviteCode('br.app.tamoon://invite/?code=a1b2c3d4'),'A1B2C3D4');
 for(const raw of ['','https://evil.example/?code=A1B2C3D4','br.app.tamoon://auth/callback?code=A1B2C3D4','br.app.tamoon://invite.evil/?code=A1B2C3D4','br.app.tamoon://user@invite?code=A1B2C3D4','br.app.tamoon://invite/other?code=A1B2C3D4',url+'&code=00000000',url+'#other','br.app.tamoon://invite?code=<script>','br.app.tamoon://invite?code=123'])assert.equal(inviteCode(raw),null,raw);
});
test('Warm app opens the confirmation form without joining',()=>{
 const f=fixture();assert.equal(f.receive(url),true);assert.equal(f.storage.getItem('tamoon-pending-invite'),'A1B2C3D4');assert.equal(f.app.pendingInvite,'A1B2C3D4');assert.deepEqual(f.calls,['A1B2C3D4']);
});
test('Cold startup, login and legal acceptance keep the invite pending',()=>{
 for(const blocked of ['cold','loading','logged-out','legal']){
  const f=fixture();
  if(blocked==='cold')f.options.getApp=()=>undefined;
  if(blocked==='loading')f.app.ready=false;
  if(blocked==='logged-out')f.app.state.profile=null;
  if(blocked==='legal')f.app.legalGateVisible=true;
  createInviteReceiver(f.options)(url,{launch:true});
  assert.equal(f.storage.getItem('tamoon-pending-invite'),'A1B2C3D4');assert.deepEqual(f.calls,[]);
 }
});
test('Marketplace returns to local Community on both platforms preserving the code',()=>{
 for(const protocol of ['https:','capacitor:']){
  const f=fixture();f.options.location.pathname='/marketplace/index.html';f.options.location.protocol=protocol;
  f.receive(url);assert.equal(f.storage.getItem('tamoon-pending-invite'),'A1B2C3D4');assert.deepEqual(f.calls,[protocol+'//localhost/']);
 }
});
test('Original launch URL does not reopen a completed invite on document navigation',()=>{
 const f=fixture();f.receive(url,{launch:true});f.storage.removeItem('tamoon-pending-invite');f.app.pendingInvite='';f.calls.length=0;
 const afterNavigation=createInviteReceiver(f.options);
 assert.equal(afterNavigation(url,{launch:true}),false);assert.deepEqual(f.calls,[]);
 assert.equal(afterNavigation(url),true);assert.deepEqual(f.calls,['A1B2C3D4'],'A fresh user tap may open the same invite again');
});
test('A late launch result cannot replace a newer tap, and OAuth is left alone',()=>{
 const f=fixture();f.receive('br.app.tamoon://invite?code=00000001');
 assert.equal(f.receive(url,{launch:true}),false);
 assert.equal(f.receive('br.app.tamoon://auth/callback?code=oauth-code'),false);
 assert.equal(f.app.pendingInvite,'00000001');assert.deepEqual(f.calls,['00000001']);
});
