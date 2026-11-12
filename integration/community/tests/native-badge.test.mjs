import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeBadge,refreshNativeInbox} from '../../../mobile/src/badge.mjs';
import {apnsPayload,createApnsSender} from '../../../supabase/functions/publish-announcement/apns.mjs';
import {fcmPayload} from '../../../supabase/functions/publish-announcement/fcm.mjs';

for (const count of [0,1,200,undefined,-1,201,1.2,'3',null]) {
  test(`native providers validate badge count ${JSON.stringify(count)}`,()=>{
    const notification={badgeCount:count,data:{url:'/',badgeCount:99,secret:'hidden'}};
    const expected=Number.isInteger(count)&&count>=0&&count<=200?count:undefined;
    assert.equal(apnsPayload(notification).aps.badge,expected);
    assert.equal(fcmPayload('fcm://Android_Test_0123456789:Token',notification).message.android.notification.notification_count,expected);
  });
}
test('invalid iOS destinations fail locally with 400, without credentials or network',async()=>{
  const sender=createApnsSender({env:()=>{throw Error('Must not load credentials');},request:()=>{throw Error('Must not send');}});
  for (const url of ['https://resenhafc-beta.pages.dev/','https://evil.test/','http://[','https://app.tamoon.app.br/marketplace/']) {
    await assert.rejects(sender(`apns://production/${'a'.repeat(64)}`,{data:{url}},'id'),{statusCode:400,body:'INVALID_NOTIFICATION_URL'});
  }
});
function fixture({android=false}={}) {
  const calls=[];
  const app={ready:true,state:{profile:{id:'one'},user_notifications:[{id:'read',read_at:'today'},{id:'unread',read_at:null}]},repo:{loadUserNotifications:async()=>{calls.push('reload');}},updateNotificationBadge:()=>calls.push('refresh')};
  const plugin={
    getDeliveredNotifications:async()=>({notifications:[
      {id:'a',data:{url:'https://app.tamoon.app.br/?notification=read'}},
      {id:'b',data:{url:'https://app.tamoon.app.br/?notification=unread'}},
      {id:'c',data:{url:'https://app.tamoon.app.br/?notification=new-arrival'}},
      {id:'d',data:{url:'https://evil.test/?notification=read'}}
    ]}),
    removeDeliveredNotifications:async({notifications})=>calls.push(notifications.map(v=>v.id)),
    removeAllDeliveredNotifications:async()=>calls.push('clear')
  };
  const badge=createNativeBadge({plugin,setCount:android?null:async n=>calls.push(n),getApp:()=>app});
  return {app,badge,calls,plugin};
}
for (const android of [false,true]) test(`${android?'Android':'iOS'} removes only read notifications, preserving new arrivals`,async()=>{
  const f=fixture({android});await f.badge.sync(1);
  assert.deepEqual(f.calls,android?[['a']]:[1,['a']]);
});
test('badge updates preserve order and sign-out discards queued account updates',async()=>{
  const f=fixture();const first=f.badge.sync(3);const second=f.badge.sync(2);await Promise.all([first,second]);
  assert.deepEqual(f.calls,[3,['a'],2,['a']]);f.calls.length=0;
  const old=f.badge.sync(4);const clear=f.badge.clear();await Promise.all([old,clear]);
  await f.badge.sync(7); // a late inbox refresh during sign-out must stay cleared
  assert.deepEqual(f.calls,[0,'clear']);
  f.badge.activate();await f.badge.sync(1);assert.deepEqual(f.calls,[0,'clear',1,['a']]);
});
test('queued updates cannot affect another account',async()=>{
  const f=fixture();const old=f.badge.sync(4);f.app.state.profile.id='two';await old;
  assert.deepEqual(f.calls,[]);
});
test('denied badge permission does not stop removal of read notifications',async()=>{
  const f=fixture();const badge=createNativeBadge({plugin:f.plugin,setCount:async()=>{throw Error('denied');},getApp:()=>f.app});
  await badge.sync(1);assert.deepEqual(f.calls,[['a']]);
});
test('resume reloads inbox and refreshes badge; logout during reload does not refresh',async()=>{
  const f=fixture();await refreshNativeInbox(()=>f.app);assert.deepEqual(f.calls,['reload','refresh']);f.calls.length=0;
  f.app.repo.loadUserNotifications=async()=>{f.app.state.profile=null;};
  await refreshNativeInbox(()=>f.app);assert.deepEqual(f.calls,[]);
});
