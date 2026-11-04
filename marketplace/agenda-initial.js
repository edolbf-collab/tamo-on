/* Initial agenda migration: private holds, explicit first association, native monthly acceptance. */
(() => {
  "use strict";
  const HEADERS=["mensalista","email","dia_semana","inicio","fim"];
  const days=["","Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"];
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  const messages={
    AGENDA_INITIAL_LIMIT:"Envie de 1 a 200 mensalistas por arquivo, até 512 KB.",
    AGENDA_INITIAL_ACCOUNT:"Entre com uma conta ativa para continuar.",
    AGENDA_INITIAL_PERMISSION:"Sua conta não possui permissão para gerenciar esta agenda.",
    AGENDA_INITIAL_PARTNER:"O parceiro precisa estar aprovado.",
    AGENDA_INITIAL_SPACE:"Selecione um espaço ativo com agenda publicada.",
    AGENDA_INITIAL_REVIEW:"Os dados foram atualizados. Atualize a tela e confira novamente.",
    AGENDA_INITIAL_EXPIRED:"A prévia venceu. Analise o arquivo novamente.",
    AGENDA_INITIAL_CLOSED:"A importação inicial deste parceiro já foi encerrada.",
    AGENDA_INITIAL_FIX_ROWS:"Corrija as linhas indicadas e analise novamente antes de importar.",
    AGENDA_INITIAL_NOT_FOUND:"Registro não encontrado ou indisponível.",
    AGENDA_INITIAL_INVITE:"Convite inválido, vencido ou já utilizado. Peça um novo código ao parceiro.",
    AGENDA_INITIAL_EMAIL:"Este convite está destinado a outro e-mail. Confira sua conta ou peça ao parceiro que corrija o contato.",
    AGENDA_INITIAL_GROUP_PERMISSION:"É necessário administrar ou organizar o grupo confirmado para esta operação.",
    AGENDA_INITIAL_TERMS:"Confira e aceite expressamente as condições do vínculo.",
    AGENDA_INITIAL_NO_FUTURE:"O parceiro precisa publicar as próximas datas desse horário antes do aceite.",
    AGENDA_INITIAL_REASON:"Informe um motivo com pelo menos três caracteres.",
    AGENDA_INITIAL_CONTACT:"Confira o nome e o e-mail informado.",
    AGENDA_INITIAL_SLOT_PROTECTED:"Horário protegido pela importação inicial. Gerencie em Mensalistas importados.",
    PARTNER_PREVIEW_READ_ONLY:"A visualização do parceiro é somente leitura. Volte à conta autorizada.",
    MARKETPLACE_ACCOUNT_BLOCKED:"Esta conta está bloqueada.",
    AUTH_REQUIRED:"Entre na sua conta para continuar."
  };
  const errorMessage=e=>Object.entries(messages).find(([key])=>String(e?.message||e).includes(key))?.[1]||"Não foi possível concluir. Atualize e tente novamente. "+String(e?.message||e);
  const range=r=>`${days[r.weekday]||r.source?.dia_semana||""} · ${String(r.start_time||r.source?.inicio||"").slice(0,5)}–${String(r.end_time||r.source?.fim||"").slice(0,5)}`;
  const labels={protected:"Aguardando vinculação",approved:"Aguardando aceite",linked:"Vínculo mensalista normal",released:"Horário liberado"};
  function parseCSV(text) {
    if (typeof text!=="string" || new TextEncoder().encode(text).length>524288) throw new Error(messages.AGENDA_INITIAL_LIMIT);
    text=text.replace(/^\uFEFF/,"");
    const header=text.split(/\r?\n/,1)[0];
    const delimiter=header.includes(";")?";":",";
    const records=[];let row=[],cell="",quoted=false,closed=false;
    function pushCell(){row.push(cell);cell="";closed=false;}
    function pushRow(){pushCell();if(row.some(v=>v.trim()!==""))records.push(row);row=[];if(records.length>201)throw new Error(messages.AGENDA_INITIAL_LIMIT);}
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
      else if(c==='"'){if(cell!==""||closed)throw new Error("Aspas inválidas no CSV. Exporte novamente como CSV UTF-8.");quoted=true;}
      else if(c===delimiter)pushCell();
      else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();}
      else {if(closed)throw new Error("Há texto após as aspas no CSV.");cell+=c;}
    }
    if(quoted)throw new Error("Há aspas sem fechamento no CSV.");
    if(cell!==""||row.length||closed)pushRow();
    const headers=(records.shift()||[]).map(v=>v.trim());
    if(headers.length!==HEADERS.length||new Set(headers).size!==HEADERS.length||HEADERS.some(h=>!headers.includes(h)))throw new Error("Cabeçalho diferente do modelo. Preserve os nomes e as cinco colunas.");
    if(!records.length)throw new Error("Preencha pelo menos um mensalista no CSV.");
    return records.map((record,index)=>{
      if(record.length!==headers.length)throw new Error(`Registro ${index+1}: quantidade de colunas diferente do cabeçalho.`);
      if(record.some(v=>v.length>1000||v.includes("\0")))throw new Error(`Registro ${index+1}: conteúdo inválido ou muito longo.`);
      return Object.fromEntries(headers.map((h,i)=>[h,record[i].trim()]));
    });
  }
  function csv(rows) {
    const quote=value=>'"'+String(value??"").replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
    return '\uFEFF'+[HEADERS,...rows.map(r=>HEADERS.map(h=>r[h]??""))].map(row=>row.map(quote).join(";")).join("\r\n")+'\r\n';
  }

  function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function periodPrices(o){
    const periods=Array.isArray(o.periods)?o.periods:[];
    return periods.length?periods.map(p=>`${String(p.service_month||"").slice(5,7)}/${String(p.service_month||"").slice(0,4)}: ${money(p.monthly_price)}`).join(" · "): `${money(o.monthly_price)}/mês`;
  }
  function offerHTML(o){
    const date=o.first_at?new Date(o.first_at).toLocaleDateString("pt-BR",{timeZone:o.timezone||"America/Sao_Paulo"}):"Aguardando publicação das próximas datas";
    return `<div class="initial-offer"><strong>${esc(o.venue_name)} · ${esc(o.space_name)}</strong><p>${esc(range(o))}</p><p><strong>${esc(periodPrices(o))}</strong></p><p>Valores das agendas publicadas. O horário é protegido; o preço de um novo mês será apresentado antes da pré-reserva.</p><p>Primeira data futura: ${esc(date)}</p><small>${Number(o.protected_dates||0)} datas publicadas. Após o aceite, aplicam-se as regras normais dos mensalistas.</small></div>`;
  }
  function previewHTML(preview){return `<div class="table-wrap"><table class="agenda-initial-table"><thead><tr><th>Mensalista</th><th>Horário</th><th>Mensalidade da agenda</th><th>Conferência</th></tr></thead><tbody>${(preview.report||[]).map(r=>`<tr><td>${esc(r.label||r.source?.mensalista)}<small>Linha ${Number(r.line)}</small></td><td>${esc(range(r))}</td><td>${r.monthly_price?money(r.monthly_price):"—"}</td><td><strong>${esc({ready:"Pronto",error:"Corrigir",duplicate:"Já importado"}[r.state]||r.state)}</strong><small>${esc(r.message)}</small></td></tr>`).join("")}</tbody></table></div>`;}
  function session({root,rpc,isAllowed}){
    let busy=false,disposed=false;const dialog=root.closest("dialog");
    const allowed=()=>!disposed&&root.isConnected&&isAllowed();
    const call=async(name,args)=>{if(!allowed())throw Error("AGENDA_INITIAL_PERMISSION");const result=await rpc(name,args);if(!allowed())throw Error("AGENDA_INITIAL_PERMISSION");return result;};
    const message=(text,error=false)=>{if(disposed)return;const el=root.querySelector('[data-message]');if(el){el.textContent=text;el.classList.toggle("is-error",error);}};
    const run=async work=>{if(busy||!allowed())return;busy=true;root.setAttribute("aria-busy","true");const disabled=[...root.querySelectorAll("button,input,select")].map(el=>[el,el.disabled]);disabled.forEach(([el])=>el.disabled=true);
      try{await work();}catch(e){if(allowed())message(errorMessage(e),true);}finally{busy=false;root.setAttribute("aria-busy","false");disabled.forEach(([el,value])=>{if(el.isConnected)el.disabled=value;});root.dispatchEvent(new Event("initial-idle"));}};
    const dispose=()=>{disposed=true;root.replaceChildren();};dialog?.addEventListener("cancel",event=>{if(busy)event.preventDefault();});dialog?.addEventListener("close",dispose,{once:true});
    return {allowed,call,message,run,get busy(){return busy;}};
  }
  function mountManager(options){
    const {root,partnerId,partnerName,onChanged}=options;let context={spaces:[],entries:[],import_open:true},preview=null;
    root.innerHTML=`<section class="agenda-initial"><p><strong>${esc(partnerName)}</strong></p><p data-initial-intro>Transcreva os mensalistas que já utilizam a quadra. A lista protege os horários e permite vincular os grupos depois.</p>
      <div data-import-area><label class="field"><span>Quadra / espaço</span><select data-space><option value="">Carregando espaços…</option></select></label>
      <p>Uma quadra por arquivo. Informe apenas mensalista, e-mail opcional, dia da semana, início e fim. O valor mensal será obtido da agenda publicada.</p>
      <div class="initial-controls"><button type="button" class="button secondary" data-action-initial="template">Baixar modelo</button><label class="field"><span>Lista em CSV UTF-8</span><input type="file" accept=".csv,text/csv" data-file></label><button type="button" class="button primary" data-action-initial="preview">Analisar lista</button></div>
      <div data-preview></div><div data-confirm hidden><label class="initial-check"><input type="checkbox" data-ack><span>Conferi os mensalistas, os horários e os valores. Confirmo a proteção dos horários indicados.</span></label><button type="button" class="button primary" data-action-initial="commit" disabled>Importar e proteger horários</button></div></div>
      <p data-message role="status" aria-live="polite"></p><div class="section-heading"><h3>Mensalistas importados</h3><button type="button" class="button ghost" data-action-initial="refresh">Atualizar</button></div><div data-entries></div><div data-task></div>
      <details data-close-area><summary>Concluir a importação inicial</summary><p>Quando todas as listas deste parceiro estiverem importadas, encerre esta etapa. Convites e aceites pendentes continuam disponíveis.</p><label class="initial-check"><input type="checkbox" data-close-ack><span>Já importei as listas de todos os espaços deste parceiro.</span></label><button class="button secondary" type="button" data-action-initial="close">Encerrar importação inicial</button></details></section>`;
    const s=session(options),q=sel=>root.querySelector(sel);
    const sync=()=>{const can=preview&&preview.state!=="imported"&&preview.report.some(r=>r.state==="ready")&&!preview.report.some(r=>r.state==="error");q('[data-action-initial="commit"]').disabled=s.busy||!can||!q('[data-ack]').checked;};
    root.addEventListener("initial-idle",sync);q('[data-ack]').addEventListener("change",sync);
    const invalidate=()=>{preview=null;q('[data-preview]').replaceChildren();q('[data-confirm]').hidden=true;q('[data-ack]').checked=false;sync();};
    q('[data-space]').addEventListener("change",invalidate);q('[data-file]').addEventListener("change",invalidate);
    function drawEntries(){q('[data-entries]').innerHTML=context.entries.map(e=>`<article class="initial-entry"><div><span class="status status-neutral">${esc(labels[e.state])}</span><h4>${esc(e.label)}</h4><p>${esc(e.space_name)} · ${esc(range(e))}</p><small>${esc(periodPrices(e))}${e.email?` · ${esc(e.email)}`:""}</small>${e.group_name?`<p>Grupo confirmado: <strong>${esc(e.group_name)}</strong></p>`:""}</div>
      <div class="initial-controls">${e.state==="protected"?`<button class="button secondary small" type="button" data-action-initial="invite" data-entry="${esc(e.entry_id)}">${e.invite_active?"Substituir convite":"Gerar convite"}</button><button class="button ghost small" type="button" data-action-initial="edit" data-entry="${esc(e.entry_id)}">Corrigir identificação</button>`:""}${["protected","approved"].includes(e.state)?`<button class="button danger small" type="button" data-action-initial="release" data-entry="${esc(e.entry_id)}">Liberar horário importado</button>`:""}</div>
      ${(e.claims||[]).filter(c=>c.status==="pending").map(c=>`<div class="initial-claim"><strong>${esc(e.label)} → ${esc(c.group_name)}</strong><p>Solicitado por ${esc(c.profile_name)} · ${esc(c.profile_email)}</p><p>Confirme que este é o grupo do mensalista da sua lista.</p><label class="initial-check"><input type="checkbox" data-claim-ack="${esc(c.id)}"><span>Reconheço o responsável e este grupo.</span></label><div class="initial-controls"><button class="button primary small" type="button" data-action-initial="approve" data-entry="${esc(e.entry_id)}" data-claim="${esc(c.id)}" ${c.authorized?"":"disabled"}>Confirmar primeira associação</button><button class="button ghost small" type="button" data-action-initial="reject" data-entry="${esc(e.entry_id)}" data-claim="${esc(c.id)}">Recusar solicitação</button></div>${c.authorized?"":"<small>O solicitante perdeu a permissão para administrar este grupo.</small>"}</div>`).join("")}</article>`).join("")||"<p>Nenhum mensalista importado.</p>";}
    async function load(){const selected=q('[data-space]').value;context=await s.call("agenda_initial_context",{p_partner_id:partnerId});q('[data-space]').innerHTML='<option value="">Selecione a quadra</option>'+context.spaces.map(x=>`<option value="${esc(x.id)}">${esc(x.venue)} · ${esc(x.name)}</option>`).join("");q('[data-space]').value=selected|| (context.spaces.length===1?context.spaces[0].id:"");q('[data-initial-intro]').textContent=context.import_open?'Importe sua lista de mensalistas para proteger os horários. Depois, convide os responsáveis para vincular seus grupos.':'Importação inicial concluída. Acompanhe abaixo os convites e aceites pendentes.';q('[data-import-area]').hidden=!context.import_open;q('[data-close-area]').hidden=!context.import_open;drawEntries();}
    async function changed(){await load();await onChanged?.();}
    root.addEventListener("click",event=>{const b=event.target.closest('[data-action-initial]');if(!b||!root.contains(b))return;event.preventDefault();event.stopPropagation();const action=b.dataset.actionInitial;
      s.run(async()=>{const e=context.entries.find(x=>x.entry_id===b.dataset.entry);s.message("");
        if(action==="template"){download("modelo-agenda-inicial.csv",csv([{mensalista:"Turma do João",email:"",dia_semana:"Segunda",inicio:"19:00",fim:"20:00"}]));return;}
        if(action==="refresh"){await load();s.message("Lista atualizada.");return;}
        if(action==="preview"){
          const space=q('[data-space]').value,file=q('[data-file]').files?.[0];if(!space)throw Error("AGENDA_INITIAL_SPACE");if(!file||!file.name.toLowerCase().endsWith(".csv")||file.size>524288)throw Error("Selecione um CSV de até 512 KB.");
          let text;try{text=new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer());}catch{throw Error("Salve a lista como CSV UTF-8.");}
          preview=await s.call("agenda_initial_preview",{p_partner_id:partnerId,p_space_id:space,p_rows:parseCSV(text)});q('[data-preview]').innerHTML=previewHTML(preview);q('[data-confirm]').hidden=false;q('[data-ack]').checked=false;return;
        }
        if(action==="commit"){
          if(!preview||!q('[data-ack]').checked||preview.report.some(r=>r.state==="error"))return;
          preview=await s.call("agenda_initial_commit",{p_batch_id:preview.batch_id,p_token:preview.token});q('[data-preview]').innerHTML=previewHTML(preview);q('[data-ack]').checked=false;
          if(preview.state==="review_required"){s.message("A agenda mudou. Confira a nova prévia e confirme novamente.");return;}
          q('[data-confirm]').hidden=true;await changed();s.message(`${preview.created} mensalista(s) importado(s). Os horários já estão protegidos.`);return;
        }
        if(action==="close"){if(!q('[data-close-ack]').checked)throw Error("Confirme que todas as listas já foram importadas.");await s.call("agenda_initial_close",{p_partner_id:partnerId});invalidate();await load();s.message("Importação inicial encerrada. Os vínculos pendentes podem continuar.");return;}
        if(!e)return;
        if(action==="invite"){
          if(e.invite_active){q('[data-task]').innerHTML=`<div class="initial-task"><p>Substituir o convite de <strong>${esc(e.label)}</strong> invalida o código anterior e as solicitações pendentes.</p><button class="button primary" type="button" data-action-initial="issue" data-entry="${esc(e.entry_id)}">Confirmar novo convite</button></div>`;return;}
          await issue(e);return;
        }
        if(action==="issue"){await issue(e);return;}
        if(action==="edit"){q('[data-task]').innerHTML=`<div class="initial-task"><h4>Corrigir ${esc(e.label)}</h4><label class="field"><span>Mensalista / responsável</span><input data-edit-label maxlength="150" value="${esc(e.label)}"></label><label class="field"><span>E-mail — opcional</span><input type="email" data-edit-email value="${esc(e.email||"")}"></label><p>A correção invalida o convite anterior e as solicitações pendentes. Os horários continuam protegidos.</p><button class="button primary" type="button" data-action-initial="save-edit" data-entry="${esc(e.entry_id)}">Salvar identificação</button></div>`;return;}
        if(action==="save-edit"){await s.call("agenda_initial_edit",{p_entry_id:e.entry_id,p_revision:e.revision,p_label:q('[data-edit-label]').value,p_email:q('[data-edit-email]').value});q('[data-task]').replaceChildren();await load();s.message("Identificação corrigida. Gere um novo convite.");return;}
        if(action==="release"){q('[data-task]').innerHTML=`<div class="initial-task"><h4>Liberar ${esc(e.label)} · ${esc(range(e))}</h4><p>Esta ação remove a proteção inicial e invalida o convite. Outros grupos poderão reservar os horários livres.</p><label class="field"><span>Motivo</span><input data-release-reason maxlength="500"></label><button class="button danger" type="button" data-action-initial="confirm-release" data-entry="${esc(e.entry_id)}">Confirmar liberação</button></div>`;return;}
        if(action==="confirm-release"){await s.call("agenda_initial_release",{p_entry_id:e.entry_id,p_revision:e.revision,p_reason:q('[data-release-reason]').value});q('[data-task]').replaceChildren();await changed();s.message("Proteção inicial removida.");return;}
        if(action==="approve"||action==="reject"){
          if(action==="approve"&&!root.querySelector(`[data-claim-ack="${b.dataset.claim}"]`)?.checked)throw Error("Confirme que reconhece o responsável e o grupo.");
          await s.call("agenda_initial_decide",{p_claim_id:b.dataset.claim,p_approve:action==="approve",p_revision:e.revision});await load();s.message(action==="approve"?"Primeira associação confirmada. O grupo pode revisar e aceitar o vínculo.":"Solicitação recusada. O horário continua protegido.");
        }
      });
    });
    async function issue(e){const invitation=await s.call("agenda_initial_invite",{p_entry_id:e.entry_id,p_revision:e.revision});await load();q('[data-task]').innerHTML=`<div class="initial-task"><h4>Convite de ${esc(e.label)}</h4><p>Entregue este código ao responsável. No Tâmo On, ele deve abrir Minhas reservas → Mensalistas → Vincular horário importado.</p><input aria-label="Código do convite" readonly value="${esc(invitation.code)}"><small>Válido por 30 dias. O vencimento do convite não libera o horário.</small></div>`;}
    s.run(load);return s;
  }
  function mountUser(options){
    const {root,onChanged}=options;let context={groups:[],requests:[]};
    root.innerHTML=`<section class="agenda-initial"><p>Use o código fornecido pelo parceiro para associar ao seu grupo um horário já utilizado antes da entrada no Tâmo On.</p><label class="field"><span>Código do convite</span><input data-code autocomplete="off" maxlength="32"></label><label class="field"><span>Seu grupo</span><select data-group></select></label><p data-no-groups hidden>Crie o grupo na Comunidade ou peça permissão para administrá-lo. Depois, atualize esta lista.</p><div class="initial-controls"><button class="button primary" type="button" data-user-action="claim">Solicitar primeira vinculação</button><button class="button ghost" type="button" data-user-action="refresh">Atualizar</button></div><p data-message role="status" aria-live="polite"></p><div data-requests></div></section>`;
    const s=session(options),q=sel=>root.querySelector(sel);
    async function load(){const selected=q('[data-group]').value;context=await s.call("agenda_initial_user_context",{});q('[data-group]').innerHTML='<option value="">Selecione seu grupo</option>'+context.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");q('[data-group]').value=selected;q('[data-no-groups]').hidden=!!context.groups.length;
      q('[data-requests]').innerHTML=context.requests.map(r=>`<article class="initial-entry"><h4>${esc(r.label)} → ${esc(r.group_name)}</h4><p>${esc(r.partner_name)}</p><strong>${esc(r.offer?.state==="linked"?"Vínculo concluído. Acompanhe em Minhas reservas.":r.status==="pending"?"Aguardando confirmação do parceiro":r.status==="rejected"?"Solicitação não aprovada ou convite substituído":"Primeira associação confirmada")}</strong>${r.offer&&r.offer.state==="approved"?`${offerHTML(r.offer)}<p>O aceite protege a recorrência para este grupo. O pagamento antecipado é opcional; a garantia e o saldo obedecem aos prazos de cada ciclo, disponíveis em Minhas reservas. Confira os valores antes de continuar.</p><label class="initial-check"><input type="checkbox" data-terms="${esc(r.offer.entry_id)}"><span>Conferi grupo, horário e valores de cada mês e aceito as regras mensalistas.</span></label><button class="button primary" type="button" data-user-action="accept" data-entry="${esc(r.offer.entry_id)}" ${r.offer.protected_dates?"":"disabled"}>Aceitar vínculo mensalista</button>`:""}</article>`).join("");}
    root.addEventListener("click",event=>{const b=event.target.closest('[data-user-action]');if(!b||!root.contains(b))return;event.preventDefault();event.stopPropagation();s.run(async()=>{
      if(b.dataset.userAction==="refresh"){await load();s.message("Lista atualizada.");return;}
      if(b.dataset.userAction==="claim"){const group=q('[data-group]').value;if(!group)throw Error("Selecione um grupo que você administra.");await s.call("agenda_initial_claim",{p_code:q('[data-code]').value.trim(),p_group_id:group});q('[data-code]').value="";await load();s.message("Solicitação enviada para conferência do parceiro. O horário permanece protegido.");return;}
      const offer=context.requests.find(r=>r.offer?.entry_id===b.dataset.entry)?.offer;
      if(!offer||!root.querySelector(`[data-terms="${b.dataset.entry}"]`)?.checked)throw Error("AGENDA_INITIAL_TERMS");
      await s.call("agenda_initial_accept",{p_entry_id:offer.entry_id,p_revision:offer.revision,p_terms_accepted:true,p_review_token:offer.review_token});await load();await onChanged?.();s.message("Vínculo aceito. Os próximos passos estão em Minhas reservas → Mensalistas.");
    });});s.run(load);return s;
  }
  globalThis.MarketplaceAgendaInitial={HEADERS,parseCSV,csv,previewHTML,offerHTML,errorMessage,mountManager,mountUser};
})();
