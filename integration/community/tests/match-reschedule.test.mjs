import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { rescheduleAndNotify } from '../../../supabase/functions/publish-announcement/match-reschedule.mjs';

function fixture(overrides={}) {
 const events=[];
 const result={group_id:'g1',match_id:'m1',title:'Pelada',previous_starts_at:'2030-01-01T22:00:00Z',starts_at:'2030-01-02T23:00:00Z',schedule_changed:true,change_id:'42'};
 const args={payload:{matchId:'m1',startsAt:result.starts_at,expectedStartsAt:result.previous_starts_at,maxPlayers:12,durationMinutes:60},
  groupId:'g1',groupName:'Grupo',userId:'organizer',appOrigin:'https://example.test',
  save:async params=>{events.push(['save',params]);return result},
  sendGroupPush:async options=>{events.push(['push',options]);return {sent:2,failed:0,subscriptions:2}},
  formatDateTime:(iso,tz)=>{assert.equal(tz,'America/Sao_Paulo');return {date:iso.slice(0,10),time:iso.slice(11,16)}},...overrides};
 return {args,events,result};
}
test('saves under caller identity before notifying; notification uses authoritative dates and deep link',async()=>{
 const f=fixture(); f.args.payload.title='Forged title'; f.args.payload.previousStartsAt='Forged date';
 const response=await rescheduleAndNotify(f.args);
 assert.equal(response.saved,true);assert.equal(response.sent,2);
 assert.deepEqual(f.events.map(e=>e[0]),['save','push']);
 assert.equal(f.events[0][1].p_expected_starts_at,f.result.previous_starts_at);
 const push=f.events[1][1];assert.match(push.body,/Pelada.*2030-01-01.*2030-01-02/);
 assert.doesNotMatch(push.body,/Forged/);assert.equal(push.excludeUserId,'organizer');
 assert.equal(push.data.eventType,'match-rescheduled');assert.equal(push.tag,'match-rescheduled-42');
 assert.equal(push.url,'https://example.test/?group=g1&page=matches&match=m1');
});
test('unchanged date does not send a duplicate notice',async()=>{
 const f=fixture();f.result.schedule_changed=false;
 assert.equal((await rescheduleAndNotify(f.args)).saved,true);assert.equal(f.events.length,1);
});
test('rejected update never sends a notice',async()=>{
 const f=fixture({save:async()=>{throw Error('stale date')}});
 await assert.rejects(rescheduleAndNotify(f.args),/stale date/);assert.equal(f.events.length,0);
});
for(const key of ['group_id','match_id']) test(`rejects mismatched ${key} before notifying`,async()=>{
 const f=fixture();f.result[key]='foreign';
 await assert.rejects(rescheduleAndNotify(f.args),/MATCH_UPDATE_INVALID/);assert.equal(f.events.length,1);
});
test('push outage is reported without reporting a saved date as failed',async()=>{
 const f=fixture({sendGroupPush:async()=>{throw Error('offline')}});
 const response=await rescheduleAndNotify(f.args);
 assert.equal(response.saved,true);assert.equal(response.notificationError,true);
 assert.equal(response.result.starts_at,f.result.starts_at);
});
test('partial delivery preserves device failure counts',async()=>{
 const f=fixture({sendGroupPush:async()=>({sent:1,failed:2,subscriptions:3})});
 const response=await rescheduleAndNotify(f.args);assert.equal(response.failed,2);assert.equal(response.sent,1);
});

const app=fs.readFileSync(new URL('../../../app.js',import.meta.url),'utf8');
const slice=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
function repoFixture() {
 const code=slice('    async updateMatchSettings(', '    async createMatchGuest(');
 const repo=vm.runInNewContext(`({${code}})`,{Error,Number});
 const calls=[];Object.assign(repo,{state:{currentGroupId:'g1'},
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:{match_id:'m1'}}}},
  invokeNotification:async args=>{calls.push({name:'edge',args});return {saved:true,sent:1}},loadGroup:async()=>{}});
 return {repo,calls};
}
test('date editing goes through the authenticated save-and-notify action',async()=>{
 const f=repoFixture();await f.repo.updateMatchSettings('m1',{startsAt:'new',expectedStartsAt:'old',maxPlayers:12,durationMinutes:60});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.action,'match-reschedule');
 assert.equal(f.calls[0].args.expectedStartsAt,'old');assert.equal(f.calls[0].args.groupId,'g1');
});
test('ordinary settings retain the original RPC and never send reschedule push',async()=>{
 const f=repoFixture();await f.repo.updateMatchSettings('m1',{maxPlayers:12,durationMinutes:60});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'update_match_settings');
});
test('refresh failure after save is distinct from save failure',async()=>{
 const f=repoFixture();f.repo.loadGroup=async()=>{throw Error('offline')};
 const response=await f.repo.updateMatchSettings('m1',{startsAt:'new',maxPlayers:12,durationMinutes:60});
 assert.equal(response.saved,true);assert.equal(response.refreshError,true);
});

function uiFixture({linked=false,status='scheduled',saveError=false}={}) {
 const match={id:'m1',title:'Pelada',starts_at:'2030-01-01T21:00:00Z',status,max_players:12,recurrence_total:2};
 let onSubmit,html,closed=false;const messages=[],updates=[],button={disabled:false,textContent:'Salvar alterações'};
 const fields=new Map([['starts_at','2030-01-03T21:00'],['max_players','12'],['duration_minutes','60']]);
 const ui=vm.runInNewContext(`({${slice('    async openMatchEditForm(', '    openTeamsForMatch(')}})`,{
  Date,Number,String,Boolean,FormData:class {get(name){return fields.get(name)}},
  escapeHtml:s=>s,matchDuration:()=>60,matchSchedule:()=>'',
  $:(selector)=>selector==='#matchEditForm'?{addEventListener:(event,fn)=>{onSubmit=fn}}:button
 });
 Object.assign(ui,{repo:{state:{},matchEditContext:async()=>({match,can_reschedule:!linked,marketplace_linked:linked}),
  updateMatchSettings:async(id,args)=>{updates.push(args);if(saveError)throw Error('Date changed elsewhere');return {sent:2}}},
  canManageMatches:()=>true,isMatchStarted:()=>false,toast:(...args)=>messages.push(args),
  modal:(title,markup,fn)=>{html=markup;fn({},()=>{closed=true})},render(){},openMatchDetails(){}});
 return {ui,fields,button,messages,updates,get html(){return html},get closed(){return closed},submit:()=>onSubmit({preventDefault(){},submitter:button,currentTarget:{}})};
}
test('manual future occurrence exposes date, linked occurrence does not',async()=>{
 const manual=uiFixture();await manual.ui.openMatchEditForm('m1');assert.match(manual.html,/type="datetime-local"/);assert.match(manual.html,/somente a esta ocorrência/);
 const linked=uiFixture({linked:true});await linked.ui.openMatchEditForm('m1');assert.doesNotMatch(linked.html,/type="datetime-local"/);assert.match(linked.html,/Marketplace/);
});
test('closed event never opens editing form',async()=>{
 const f=uiFixture({status:'finished'});await f.ui.openMatchEditForm('m1');assert.equal(f.html,undefined);
});
test('past date is rejected before save and controls stay usable',async()=>{
 const f=uiFixture();await f.ui.openMatchEditForm('m1');f.fields.set('starts_at','2000-01-01T12:00');await f.submit();
 assert.equal(f.updates.length,0);assert.equal(f.button.disabled,false);assert.equal(f.closed,false);
});
test('save failure keeps editing open and restores the save button',async()=>{
 const f=uiFixture({saveError:true});await f.ui.openMatchEditForm('m1');await f.submit();
 assert.equal(f.closed,false);assert.equal(f.button.disabled,false);assert.equal(f.button.textContent,'Salvar alterações');
 assert.match(f.messages.at(-1)[0],/Date changed elsewhere/);
});
test('save includes expected timestamp and closes only after success',async()=>{
 const f=uiFixture();await f.ui.openMatchEditForm('m1');await f.submit();
 assert.equal(f.updates[0].expectedStartsAt,'2030-01-01T21:00:00Z');assert.equal(f.closed,true);assert.equal(f.button.disabled,false);
});
