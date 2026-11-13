/* Read-only metrics; no financial or personal records are cached in the browser. */
(function(global){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:1});
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct=v=>v==null?'Sem agenda':num(v)+'%';
const date=v=>String(v||'').slice(0,10).split('-').reverse().join('/');
const days=['','Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
function month(){const d=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const [y,m]=d.split('-').map(Number);return {from:`${y}-${String(m).padStart(2,'0')}-01`,to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};}
function mount(root,{rpc,identity,admin=false,partnerId=null}){
 const key=identity();let epoch=0,disposed=false,options=[],spaces=[],observer;
 const initial=month();let filters={...initial,partner:partnerId||'',space:''};
 const valid=()=>{if(disposed)return false;if(!key||identity()!==key){dispose();return false;}return true;};
 const current=e=>!disposed&&root.isConnected&&identity()===key&&epoch===e;
 const option=(value,text,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(text)}</option>`;
 function shell(){root.innerHTML=`<section class="market-metrics"><form class="metrics-filters">
 <label class="field"><span>De</span><input aria-label="Data inicial" type="date" name="from" required min="2000-01-01" max="2100-12-31" value="${filters.from}"></label>
 <label class="field"><span>Até</span><input aria-label="Data final" type="date" name="to" required min="2000-01-01" max="2100-12-31" value="${filters.to}"></label>
 ${admin?`<label class="field"><span>Parceiro</span><select name="partner">${option('','Todos os parceiros',filters.partner)}${options.map(p=>option(p.id,p.name,filters.partner)).join('')}</select></label>`:''}
 <label class="field"><span>Quadra / espaço</span><select name="space">${option('','Todos os espaços',filters.space)}${spaces.filter(s=>!filters.partner||s.partner_id===filters.partner).map(s=>option(s.id,s.name,filters.space)).join('')}</select></label>
 <div class="metrics-controls"><button class="button primary" type="submit">Atualizar métricas</button><button class="button ghost" type="button" data-metrics-month>Mês atual</button></div>
 </form><div class="metrics-status" role="status" aria-live="polite"></div><div class="metrics-results"></div></section>`;}
 const results=()=>root.querySelector('.metrics-results');
 const status=()=>root.querySelector('.metrics-status');
 const delta=(a,b,suffix='')=>b==null||a==null?'Sem base comparável':`${a-b>0?'+':''}${num(a-b)}${suffix} frente ao período anterior`;
 const card=(title,value,note)=>`<article class="card"><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;
 function show(d){
 const c=d.current,p=d.previous,h=c.hours,b=c.bookings,cash=c.cash,m=d.monthly;
 const row=s=>`<tr><td>${esc(s.name)}<br><small>${esc(s.partner)} · ${esc(s.venue)}</small></td><td>${s.occupancy==null?'Sem agenda':`<progress max="100" value="${Number(s.occupancy)}" aria-label="Ocupação de ${esc(s.name)}"></progress>${pct(s.occupancy)}`}</td><td>${num(s.booked)} h</td><td>${num(s.free)} h</td><td>${num(s.held)} h</td><td>${num(s.blocked)} h</td></tr>`;
 const heat=c.heat.filter(x=>x.available>0).sort((a,b)=>b.occupancy-a.occupancy||b.booked-a.booked||a.weekday-b.weekday||a.hour-b.hour).slice(0,10);
 results().innerHTML=`${d.test_mode?'<div class="metrics-test"><strong>Ambiente de testes</strong><br>Estes indicadores incluem os registros fictícios usados na homologação.</div>':''}
 <div class="metrics-heading"><h2>Visão do período</h2><span class="metrics-note">${date(c.from)} a ${date(c.to)}</span></div>
 <p class="metrics-note">Comparação: ${date(p.from)} a ${date(p.to)} · mesmo número de dias. Horários de Brasília.</p>
 <div class="metrics-cards">${card('Ocupação',pct(h.occupancy),delta(h.occupancy,p.hours.occupancy,' p.p.'))}${card('Horas reservadas',num(h.booked)+' h',delta(h.booked,p.hours.booked,' h'))}${card('Recebimentos',money(cash.received),'Anterior: '+money(p.cash.received))}${card('Reservas criadas',num(b.created),delta(b.created,p.bookings.created))}</div>
 <section class="card metrics-section"><h2>Uso dos espaços</h2><p class="metrics-note">${num(h.available)} h ofertadas · ${num(h.free)} h livres · ${num(h.held)} h aguardando pagamento · ${num(h.blocked)} h bloqueadas.</p>
 <div class="metrics-scroll"><table class="metrics-table"><thead><tr><th>Espaço</th><th>Ocupação</th><th>Reservadas</th><th>Livres</th><th>Em espera</th><th>Bloqueadas</th></tr></thead><tbody>${c.spaces.map(row).join('')||'<tr><td colspan="6">Nenhum espaço cadastrado neste filtro.</td></tr>'}</tbody></table></div>
 ${h.available===0?'<p class="metrics-empty">Nenhuma hora ofertada neste período. Cadastre a agenda para medir a ocupação.</p>':''}</section>
 <div class="metrics-grid metrics-section"><article class="card"><h2>Dias e horários mais ocupados</h2><p class="metrics-note">Até dez faixas, somadas por dia da semana e hora. A base em horas ajuda a avaliar o tamanho da amostra.</p><div class="metrics-scroll"><table class="metrics-table"><thead><tr><th>Faixa</th><th>Ocupação</th><th>Reservadas / ofertadas</th></tr></thead><tbody>${heat.map(x=>`<tr><td>${days[x.weekday]} · ${String(x.hour).padStart(2,'0')}h</td><td>${pct(x.occupancy)}</td><td>${num(x.booked)} / ${num(x.available)} h</td></tr>`).join('')||'<tr><td colspan="3">Sem agenda no período.</td></tr>'}</tbody></table></div></article>
 <article class="card"><h2>Reservas e cancelamentos</h2><p class="metrics-note">Situação atual das reservas criadas no período.</p><div class="metrics-cards" style="grid-template-columns:repeat(2,minmax(0,1fr))">${card('Confirmadas / concluídas',num(b.confirmed),'Aguardando pagamento: '+num(b.pending))}${card('Canceladas',num(b.cancelled),(b.cancellation_rate==null?'Sem reservas':num(b.cancellation_rate)+'% das criadas')+' · expiradas: '+num(b.expired))}${card('Valor contratado',money(b.contracted),'Somente confirmadas / concluídas')}${card('Valor médio por reserva',b.average==null?'Sem reservas':money(b.average),'Reservas avulsas e mensais juntas')}</div></article></div>
 <section class="metrics-section"><h2>Financeiro do período</h2><p class="metrics-note">Movimentações pela data em que foram registradas financeiramente, incluindo recebimentos de reservas de outros períodos.</p>
 <div class="metrics-cards">${card('Devolvido',money(cash.refunded),'Anterior: '+money(p.cash.refunded))}${card('Recebido menos devoluções',money(cash.received-cash.refunded),'Não representa lucro nem saldo disponível')}${card('Taxas registradas',money(cash.fees),'Custos do provedor registrados no histórico')}${card('Comissão reconhecida',money(cash.commission),'Comissão Tâmo On registrada no histórico')}</div>
 ${cash.legacy?'<p class="metrics-test">Parte do histórico financeiro usa datas reconstruídas de registros antigos. Consulte o Financeiro para conferir os lançamentos.</p>':''}
 <div class="metrics-cards">${card('Saldo a receber',money(c.balances.pending),'Posição atual das reservas criadas no período')}${card('Devolução pendente',money(c.balances.refund_pending),'Posição atual das reservas criadas no período')}${card('Jogos confirmados',num(c.services.occurrences),'Ocorrências com início no período')}${card('Valor alocado aos jogos',money(c.services.value),'Valor das ocorrências; não é recebimento')}</div></section>
 <section class="metrics-section"><h2>Mensalistas e recorrência</h2><div class="metrics-cards">${card('Vínculos mensais ativos',num(m.active),'Situação atual, independentemente do período')}${card('Mensalidades dos ativos',money(m.monthly_value),'Soma dos valores cadastrados; não é receita garantida')}${card('Organizadores novos',num(c.customers.new),'Primeira reserva confirmada / concluída com o parceiro')}${card('Organizadores recorrentes',num(c.customers.returning),'Já possuíam reserva confirmada / concluída antes do período')}</div><p class="metrics-note">Vínculos suspensos: ${num(m.suspended)} · outros vínculos não cancelados: ${num(m.other)}. Organizadores contados uma vez por parceiro; participantes das cotas não entram nessa contagem.</p></section>
 <details class="card metrics-details"><summary>Como os indicadores são calculados</summary><p>Ocupação = horas confirmadas ou concluídas ÷ horas ofertadas. A base vem da agenda cadastrada e das ocorrências das reservas. Bloqueios são excluídos da oferta; horários aguardando pagamento permanecem na base, mas não contam como ocupados. Sobreposições no mesmo espaço são contadas uma única vez. Uma reserva mensal ocupa apenas as datas efetivamente registradas.</p><p>Os intervalos são recortados nas datas selecionadas. Os valores dos jogos usam a data de início de cada ocorrência. Sem agenda, a ocupação aparece como indisponível; não presumimos que o espaço funcione 24 horas.</p><p>Cancelamentos consideram as reservas criadas no período que hoje estão canceladas, aguardando devolução ou devolvidas. Expiração sem pagamento é mostrada separadamente. As comparações refletem o estado atual dos registros, não uma fotografia histórica. Valores médios incluem reservas mensais e avulsas.</p><p>O Financeiro continua sendo a referência para conferir cada lançamento, disponibilidade e repasses. Estes números não incluem despesas operacionais do estabelecimento. Os dados são recalculados a cada consulta; a futura limpeza dos testes também os retirará das métricas.</p></details>`;
 status().textContent='Atualizado em '+new Date(d.generated_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília).';
 }
 function capture(){const f=new FormData(root.querySelector('form'));filters={from:String(f.get('from')),to:String(f.get('to')),partner:admin?String(f.get('partner')||''):partnerId||'',space:String(f.get('space')||'')};}
 async function load(){
 if(!valid())return;capture();const e=++epoch;results().replaceChildren();
 const span=(Date.parse(filters.to)-Date.parse(filters.from))/86400000;
 if(!Number.isFinite(span)||span<0||span>365){status().textContent='Selecione um período de até 366 dias, com a data final igual ou posterior à inicial.';return;}
 status().textContent='Calculando métricas…';root.querySelector('button[type=submit]').disabled=true;
 try{const d=await rpc('marketplace_metrics',{p_from:filters.from,p_to:filters.to,p_partner_id:filters.partner||null,p_space_id:filters.space||null});
 if(!current(e))return;if(!d?.current?.hours||!Array.isArray(d.spaces)||!Array.isArray(d.partners))throw Error('INVALID_METRICS');
 options=d.partners;spaces=d.spaces;shell();show(d);
 }catch(error){if(current(e)){status().textContent='';results().innerHTML='<p class="metrics-error" role="alert">Não foi possível consultar as métricas. Confira sua conexão e permissão de acesso, depois toque em Atualizar métricas.</p>';}}
 finally{if(current(e))root.querySelector('button[type=submit]').disabled=false;}
 }
 function submit(e){if(e.target.matches('.metrics-filters')){e.preventDefault();load();}}
 function change(e){if(!e.target.closest('.metrics-filters')||!valid())return;capture();++epoch;results().replaceChildren();status().textContent='Filtros alterados. Toque em Atualizar métricas.';root.querySelector('button[type=submit]').disabled=false;
 if(e.target.name==='partner'){filters.space='';const select=root.querySelector('[name=space]');select.innerHTML=option('','Todos os espaços','')+spaces.filter(s=>!filters.partner||s.partner_id===filters.partner).map(s=>option(s.id,s.name,'')).join('');}}
 function click(e){if(e.target.closest('[data-metrics-month]')&&valid()){filters={...filters,...month()};shell();load();}}
 function dispose(){if(disposed)return;disposed=true;++epoch;options=[];spaces=[];observer?.disconnect();root.removeEventListener('submit',submit);root.removeEventListener('change',change);root.removeEventListener('click',click);root.replaceChildren();}
 if(!key){root.textContent='Conecte-se com acesso financeiro para consultar as métricas.';return {root,key,dispose};}
 root.addEventListener('submit',submit);root.addEventListener('change',change);root.addEventListener('click',click);
 observer=new MutationObserver(()=>{if(!root.isConnected||identity()!==key)dispose();});observer.observe(document.body,{childList:true,subtree:true});
 shell();load();return {root,key,dispose};
}
global.TamoonMetrics=Object.freeze({mount});
})(window);
