import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeBack} from '../src/back.mjs';
function fixture(){const calls=[];return {calls,document:{querySelectorAll:()=>[],querySelector:()=>null},app:{ready:true,route:'home',render:()=>calls.push('render')},location:{pathname:'/',assign:url=>calls.push(url)},history:{back:()=>calls.push('history')},canGoBack:false,minimize:()=>calls.push('minimize')};}
test('Android Back respects a dialog veto and closes the community modal before navigation',async()=>{
 const f=fixture();f.document.querySelectorAll=()=>[{dispatchEvent:()=>false,close:()=>f.calls.push('close')}];await nativeBack(f);assert.deepEqual(f.calls,[]);
 f.document.querySelectorAll=()=>[];f.document.querySelector=()=>({click:()=>f.calls.push('modal')});await nativeBack(f);assert.deepEqual(f.calls,['modal']);
});
test('Android Back leaves Marketplace through its existing cleanup handler',async()=>{
 const f=fixture();f.location.pathname='/marketplace/index.html';f.marketplace={leave:async()=>f.calls.push('leave')};await nativeBack(f);assert.deepEqual(f.calls,['leave']);
});
test('Android Back returns a community tab home, then minimizes the app at its root',async()=>{
 const f=fixture();f.app.route='finance';await nativeBack(f);assert.equal(f.app.route,'home');assert.deepEqual(f.calls,['render']);await nativeBack(f);assert.deepEqual(f.calls,['render','minimize']);
});
