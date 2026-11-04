import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../../../marketplace/app.js',import.meta.url),'utf8');
const section=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b,app.indexOf(a)));
function fixture(){
 const calls=[],forms=[],details=[],invalid=[];
 const c={backendRuntime:{identityId:'owner'},state:{role:'user'},esc:String,money:n=>String(n),Date,
 backendDateTimeLabel:String,openForm:f=>forms.push(f),openDetail:d=>details.push(d),showToast(){},
 markFormFieldInvalid:(...x)=>{invalid.push(x);return false},backendErrorMessage:e=>e.message,
 runBackendMutation:async(_,operation)=>operation(),window:{MarketplaceBackend:{rpc:async(name,args)=>{calls.push({name,args});return {request_id:'case',review:false}}}},openAsaasRefund:async()=>{},setFormFieldVisible(){}};
 vm.createContext(c);vm.runInContext(section('  function cancellationContractText(', '  let cancellationPreviewSequence='),c);
 return {c,calls,forms,details,invalid};
}
test('cancellation defaults to refund and requires explicit consent to voucher only owned funds',async()=>{
 const f=fixture();f.c.openNewCancellation({id:'R1',backendId:'r1'},{automatic:true,preview_token:'signed-preview',payments:[{mine:true,amount:40},{mine:false,amount:60}]});
 const form=f.forms[0];assert.equal(form.fields.find(x=>x.name==='resolution').value,'refund');
 assert.match(form.fields.find(x=>x.name==='resolution').label,/40/);
 assert.equal(await form.onSubmit({reason:'cancel',resolution:'voucher'}),false);assert.equal(f.calls.length,0);
 await form.onSubmit({reason:'cancel',resolution:'voucher',voucher_accepted:'true'});
 assert.equal(f.calls[0].name,'submit_reservation_cancellation');assert.equal(f.calls[0].args.p_preview_token,'signed-preview');assert.equal(f.calls[0].args.p_voucher_accepted,true);
});
test('post-start review never displays the automatic choice or promises cancellation',async()=>{
 const f=fixture();f.c.openNewCancellation({id:'R1',backendId:'r1'},{automatic:false,payments:[{mine:true,amount:40}],preview_token:'review'});
 const form=f.forms[0];assert.equal(form.submitLabel,'Enviar para análise');assert.equal(form.fields.some(x=>x.name==='resolution'),false);
 assert.match(form.fields[0].html,/não cancela a reserva/);
 await form.onSubmit({reason:'specific facts',resolution:'voucher',voucher_accepted:'true'});
 assert.equal(f.calls[0].args.p_resolution,'refund');assert.equal(f.calls[0].args.p_voucher_accepted,false);
});
test('identity changes cannot submit a dialog belonging to the previous payer',async()=>{
 const f=fixture();f.c.openNewCancellation({id:'R1',backendId:'r1'},{automatic:true,payments:[]});f.c.backendRuntime.identityId='other';
 assert.equal(await f.forms[0].onSubmit({reason:'cancel'}),false);assert.equal(f.calls.length,0);
});
test('a late case directory response cannot show another identity data',async()=>{
 const f=fixture();let done;f.c.window.MarketplaceBackend.rpc=name=>name==='voucher_restitution_directory'?Promise.resolve([]):new Promise(r=>done=r);
 const pending=f.c.openCancellationCases();f.c.backendRuntime.identityId='other';done([{id:'private'}]);await pending;assert.equal(f.details.length,0);
});
test('case history is escaped and administrative decisions are hidden in the user view',async()=>{
 const f=fixture();f.c.esc=s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;');
 f.c.window.MarketplaceBackend.rpc=async()=>[{id:'case',public_code:'R1',status:'pending',reason:'<script>test</script>',can_decide:true,can_comment:true,can_refund:true,choices:[],resolution_details:{history:[{decision:'deny',reason:'<img src=x>',at:'today'}]}}];
 await f.c.openCancellationCases();let html=f.details[0].body;assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('data-action="cancellation-review"'));
 f.c.state.role='admin';await f.c.openCancellationCases();assert.match(f.details[1].body,/data-action="cancellation-review"/);
});
test('paid and pending official bookings use the same server-authoritative cancellation entry',()=>{
 const c={reservationBelongsToCurrentUser:()=>true,backendIsOnline:()=>true,esc:String,Date,
 firstReservationOccurrence:()=>({date:'future',time:'12:00'}),parsePtDateTime:()=>new Date(Date.now()+3600000)};
 vm.createContext(c);vm.runInContext(section('  function userCancellationAction(', '  function pixCollectionForReservation(')+section('  function userPendingCancellationAction(', '  function canManageMonthlyGroup('),c);
 assert.match(c.userPendingCancellationAction({id:'R1',backendOfficial:true,statusKey:'pending'}),/cancel-paid-user-reservation/);
 c.parsePtDateTime=()=>new Date(Date.now()-3600000);assert.match(c.userCancellationAction({id:'R1',backendOfficial:true,statusKey:'confirmed'}),/Solicitar análise/);
});

test('expired voucher CTA uses the exclusive Brasilia deadline and preserves a receipt',()=>{
 const f=fixture(), c=f.c;
 vm.runInContext(section('  function voucherSupportLink(', '  function userPromotions()'),c);
 const now=Date.parse('2027-02-08T02:59:59Z');
 c.Date=class extends Date {static now(){return now}};
 const item={mine:true,unused:true,expires_at:'2027-01-31T15:38:00Z',deadline:'2027-02-08T03:00:00Z'};
 const voucher={backendId:'v',code:'VC',restitution:item};
 assert.match(c.voucherRestitutionActions(voucher),/Solicitar restituição/);
 assert.match(c.voucherRestitutionActions(voucher),/07\/02\/2027/);
 c.Date=class extends Date {static now(){return now+1000}};
 assert.match(c.voucherRestitutionActions(voucher),/Falar com o suporte/);
 item.requested_at='2027-02-07';item.choice_id='protocol';
 assert.match(c.voucherRestitutionActions(voucher),/Pedido em análise/);
 assert.doesNotMatch(c.voucherRestitutionActions(voucher),/data-action=/);
 item.decision='approved'; assert.match(c.voucherRestitutionActions(voucher),/aguardando devolução/);
 item.refunded=true; assert.match(c.voucherRestitutionActions(voucher),/Restituição concluída/);
 assert.equal(c.voucherRestitutionActions({}), '');
});
