import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {nativeNotificationURL} from '../../mobile/src/push.mjs';
const source=readFileSync(new URL('../../app.js',import.meta.url),'utf8');
function method(name,next){const start=source.indexOf(`    ${name}(`);return source.slice(start,source.indexOf(`\n    ${next}(`,start));}
function fixture(base='https://app.tamoon.app.br/'){
 const ctx={URL,document:{baseURI:base,title:'Tâmo On'},appBaseUrl:()=>base,history:{replaceState(){}},localStorage:{setItem(){}},escapeHtml:s=>String(s).replaceAll('<','&lt;')};
 const methods=method('notificationAppUrl','async drainNotificationOpen')+method('async openNotificationDestination','notificationPresentation')+method('notificationTargetUrl','openNotificationCenter');
 const app=vm.runInNewContext(`({${methods}})`,ctx);
 app.ready=true;app.route='home';app.state={user_notifications:[],groups:[{id:'g'}],currentGroupId:'g',matches:[{id:'m'}],announcements:[]};
 app.modal=(...args)=>{app.lastModal=args};app.render=()=>{};app.openMatchDetails=id=>{app.openedMatch=id};app.notificationReadFeedback=item=>{app.read=item.id};
 app.repo={checkLegalAccess:async()=>{},userNotification:async()=>null,logEvent:()=>{throw Error('Unexpected error log')}};
 return app;
}
for(const base of ['https://app.tamoon.app.br/','capacitor://localhost/','https://localhost/','https://resenhafc-beta.pages.dev/']){
 test(`known origins resolve locally at ${base}`,()=>{
  const app=fixture(base);
  for(const prefix of ['https://app.tamoon.app.br/','https://resenhafc-beta.pages.dev/index.html','capacitor://localhost/','/']){
   const u=app.notificationAppUrl(prefix+'?group=g&match=m&page=matches#details');
   assert.equal(u.href,base+'?group=g&match=m&page=matches#details');
  }
 });
 test(`untrusted destinations stay blocked at ${base}`,()=>{
  const app=fixture(base);
  for(const value of ['https://evil.example/?group=g','https://app.tamoon.app.br.evil.example/','https://resenhafc-beta.pages.dev/other','javascript:alert(1)','data:text/html,test','capacitor://evil/','https://user:pass@app.tamoon.app.br/','https://app.tamoon.app.br:444/'])assert.equal(app.notificationAppUrl(value),null,value);
 });
}
test('stored legacy destination opens the match, preserving authoritative inbox routing',async()=>{
 const app=fixture();app.state.user_notifications=[{id:'n',target_url:'https://resenhafc-beta.pages.dev/?group=g&match=m&page=matches',group_id:'g',body:'Aviso'}];
 await app.openNotificationDestination('/?notification=n&match=spoof');
 assert.equal(app.openedMatch,'m');assert.equal(app.route,'matches');assert.equal(app.read,'n');
 assert.equal(app.notificationTargetUrl(app.state.user_notifications[0]),'https://app.tamoon.app.br/?group=g&match=m&page=matches');
});
test('invalid stored destination shows the message without a retry loop or external navigation',async()=>{
 const app=fixture();app.state.user_notifications=[{id:'n',target_url:'https://evil.example/',title:'Aviso',body:'Conteúdo <script>'}];
 await app.openNotificationDestination('/?notification=n');
 assert.equal(app.lastModal[0],'Aviso');assert.match(app.lastModal[1],/Conteúdo &lt;script>/);assert.doesNotMatch(app.lastModal[1],/retryNotificationOpen|evil.example/);assert.equal(app.read,'n');
});
test('native push recognizes the historical app origin and preserves query parameters',()=>{
 assert.equal(nativeNotificationURL('https://resenhafc-beta.pages.dev/?notification=n&group=g'),'capacitor://localhost/?notification=n&group=g');
 assert.equal(nativeNotificationURL('https://user:pass@app.tamoon.app.br/'),null);
 assert.equal(nativeNotificationURL('https://resenhafc-beta.pages.dev/other'),null);
});

test('notifications unavailable to the account do not open or mark content read',async()=>{
 const app=fixture();
 await app.openNotificationDestination('/?notification=other-account&match=m');
 assert.equal(app.lastModal[0],'Notificação indisponível');assert.equal(app.read,undefined);assert.equal(app.openedMatch,undefined);
});
