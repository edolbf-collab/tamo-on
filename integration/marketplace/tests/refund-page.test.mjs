import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx={Intl,Date,Promise,setTimeout};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../../../marketplace/refund-review.js',import.meta.url),'utf8'),ctx);
const api=ctx.MarketplaceRefundReview;
const now=Date.parse('2026-11-06T02:59:00Z'); // Still 05/11 in Brasília.
const row=(id,status='pending_review',extra={})=>({
 reservation_id:id,reservation_code:'RES-'+id,partner_name:'Arena '+id,requested_at:'2026-11-05T13:00:00Z',
 required:100,refunded:0,pending:100,status,payments:[],history:[],...extra
});
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const helpers={esc,money:x=>'R$ '+Number(x).toFixed(2),date:String,now};
const model=rows=>({rows,loading:false,error:'',filters:api.defaults(),page:1,updatedAt:null});
test('defaults show pending cases, prioritizing overdue followups before oldest requests',()=>{
 const rows=[row('done','completed'),row('new'),row('urgent','waiting_funds',{attention:true}),row('old','approved',{requested_at:'2026-11-01T12:00:00Z'})];
 assert.deepEqual(Array.from(api.select(rows).map(r=>r.reservation_id)),['urgent','old','new']);
 assert.equal(api.summary(rows).pending,3);
});
test('status, partner, period and reservation search combine; today uses Brasília',()=>{
 const rows=[row('A'),row('B','completed',{partner_name:'Arena A'}),row('C','approved',{requested_at:'2026-11-06T02:00:00Z'}),row('D','approved',{requested_at:'2026-11-05T02:00:00Z'})];
 assert.deepEqual(Array.from(api.select(rows,{...api.defaults(),period:'today'},now).map(r=>r.reservation_id)),['A','C']);
 assert.deepEqual(Array.from(api.select(rows,{...api.defaults(),status:'completed',partner:'Arena A',search:'res-b',period:'7'},now).map(r=>r.reservation_id)),['B']);
 assert.equal(api.select(rows,{...api.defaults(),search:'<script>'},now).length,0);
});
test('summary counts confirmed state, sums cents, and never adds completed amounts',()=>{
 const r=api.summary([row('a','waiting_funds',{pending:0.1}),row('b','processing',{pending:0.2}),row('c','completed',{pending:100})]);
 assert.equal(r.amount,0.3);assert.equal(r.waiting,1);assert.equal(r.processing,1);assert.equal(r.pending,2);
});
test('list contains no notes, payers or execution actions; details retain external refund rules',()=>{
 const r=row('A','approved',{note:'INTERNAL NOTE',reason:'PRIVATE REASON',payments:[{choice_id:'c',payer:'PRIVATE PAYER',channel:'cash',amount:100,refunded:10}]});
 const list=api.renderPage(model([r]),helpers),details=api.renderDetails(r,helpers);
 assert.doesNotMatch(list,/INTERNAL NOTE|PRIVATE REASON|PRIVATE PAYER|cancellation-cash-refund|asaas-refund-open/);
 assert.match(list,/admin-refund-details/);assert.match(details,/INTERNAL NOTE/);
 assert.match(details,/cancellation-cash-refund/);assert.match(details,/R\$ 90.00/);
 r.status='processing';assert.doesNotMatch(api.renderDetails(r,helpers),/cancellation-cash-refund|admin-refund-review/);
 r.status='completed';assert.doesNotMatch(api.renderDetails(r,helpers),/asaas-refund-open|admin-refund-review/);
});
test('unknown and failed reads never present zero balances or an empty queue as confirmed',()=>{
 const m=model(null);m.loading=true;
 let html=api.renderPage(m,helpers);
 assert.match(html,/Atualizando devoluções/);assert.match(html,/>—</);assert.doesNotMatch(html,/Nenhuma devolução registrada/);
 m.loading=false;m.error='Não foi possível atualizar';
 html=api.renderPage(m,helpers);assert.match(html,/role="alert"/);assert.doesNotMatch(html,/Nenhuma devolução registrada/);
});
test('pagination limits the visible list and filters produce a distinct empty state',()=>{
 const m=model(Array.from({length:18},(_,i)=>row(String(i).padStart(2,'0'))));
 let html=api.renderPage(m,helpers);assert.equal((html.match(/data-action="admin-refund-details"/g)||[]).length,15);
 m.page=2;html=api.renderPage(m,helpers);assert.equal((html.match(/data-action="admin-refund-details"/g)||[]).length,3);
 m.filters.search='MISSING';html=api.renderPage(m,helpers);assert.match(html,/Nenhum pedido nesta seleção/);assert.doesNotMatch(html,/Nenhuma devolução registrada/);
});
function fixture(){
 let identity='admin-a',resolve,reject,calls=0;
 const store=api.createStore({context:()=>identity,fetchRows:()=>{calls++;return new Promise((r,j)=>{resolve=r;reject=j});},onChange:()=>{}});
 return {store,setIdentity:v=>{identity=v;store.get();},resolve:rows=>resolve(rows),reject:e=>reject(e),calls:()=>calls};
}
test('only one directory request runs at a time; filters survive refresh but not identity changes',async()=>{
 const f=fixture(),first=f.store.load();await Promise.resolve();
 const second=f.store.load(true);assert.equal(f.calls(),1);
 f.resolve([row('a')]);await Promise.all([first,second]);
 f.store.setFilters({status:'completed',search:'RES'});f.store.setPage(4);
 const refresh=f.store.load(true);await Promise.resolve();f.resolve([row('b')]);await refresh;
 assert.equal(f.store.get().filters.status,'completed');assert.equal(f.store.get().page,4);
 f.setIdentity('admin-b');assert.equal(f.store.get().rows,null);assert.equal(f.store.get().filters.search,'');assert.equal(f.store.get().page,1);
});
test('late responses cannot restore data after permission loss or A -> B -> A switches',async()=>{
 for(const next of ['', 'admin-b']){
  const f=fixture(),pending=f.store.load();await Promise.resolve();
  f.setIdentity(next);f.setIdentity('admin-a');f.resolve([row('old')]);await pending;
  assert.equal(f.store.get().rows,null);assert.equal(f.store.get().loading,false);
 }
});
test('forbidden access performs no request; refresh errors clear former amounts and allow retry',async()=>{
 const f=fixture();f.setIdentity('');await f.store.load(true);assert.equal(f.calls(),0);
 f.setIdentity('admin-a');let p=f.store.load();await Promise.resolve();f.resolve([row('a')]);await p;
 p=f.store.load(true);await Promise.resolve();f.reject(Error('network'));await p;
 assert.equal(f.store.get().rows,null);assert.ok(f.store.get().error);
 p=f.store.load(true);await Promise.resolve();f.resolve([row('b')]);await p;assert.equal(f.store.get().rows[0].reservation_id,'b');
});
test('malformed directory responses fail instead of becoming a false empty queue',async()=>{
 const f=fixture(),p=f.store.load();await Promise.resolve();f.resolve({});await p;
 assert.equal(f.store.get().rows,null);assert.ok(f.store.get().error);
});
