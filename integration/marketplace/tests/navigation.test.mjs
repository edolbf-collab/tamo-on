import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../../marketplace/app.js',import.meta.url),'utf8');
function fixture(){
 const c={state:{activePage:{user:'shares',partner:'finance',admin:'finance'}},esc:String,partnerAccessPending:false,
  navigationUnreadCount:(role,page)=>role==='user'&&page==='shares'?2:0,
  messageBadge:(count,label)=>count?`<span class="message-badge">${count} ${label}</span>`:'',
  partnerPageAllowed:page=>page==='registration'};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('  const menus ='),source.indexOf('  function initialState()')),c);
 vm.runInContext(source.slice(source.indexOf('  function navigationItems('),source.indexOf('  function pageHeader(')),c);
 return c;
}
test('navigation retains the exact destinations and current page for each role',()=>{
 const c=fixture();
 for(const [role,count] of [['user',6],['admin',7]]){
  const html=c.navigationItems(role);
  assert.equal((html.match(/data-nav=/g)||[]).length,count);
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.ok(c.navShell(role,'CONTENT').includes(html));
 }
 assert.match(c.navigationItems('user'),/2 pagamento\(s\) pendente\(s\)/);
 assert.equal(c.navigationItems('candidate'),'');
});
test('restricted partner destinations cannot be navigated from the shared menu',()=>{
 const c=fixture(),html=c.navigationItems('partner');
 assert.equal((html.match(/disabled aria-disabled="true"/g)||[]).length,8);
 assert.deepEqual([...html.matchAll(/data-nav="([^"]+)"/g)].map(x=>x[1]),['registration']);
 assert.doesNotMatch(html,/data-nav="finance"/);
 c.partnerAccessPending=true;
 assert.match(c.navigationItems('partner'),/Atualizando…/);
});
test('the drawer removes destinations and closes access when the session is blocked',()=>{
 const c=fixture();let update;
 Object.assign(c,{backendRuntime:{enabled:true,bootstrap:{profile:{status:'active'}}},backendIsOnline:()=>true,
  app:{querySelector:()=>({})},mobileNavigation:{update:value=>{update=value}}});c.state.role='admin';
 c.refreshMarketplaceNavigation();assert.equal(update.allowed,true);assert.match(update.markup,/data-nav="finance"/);
 c.backendRuntime.bootstrap.profile.status='blocked';c.refreshMarketplaceNavigation();assert.equal(update.allowed,false);assert.equal(update.markup,'');
 c.backendRuntime.bootstrap.profile.status='active';c.backendIsOnline=()=>false;c.refreshMarketplaceNavigation();assert.equal(update.allowed,false);
});
