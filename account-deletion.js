(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => new Intl.DateTimeFormat('pt-BR',{dateStyle:'long',timeZone:'America/Sao_Paulo'}).format(new Date(value));
  const rpc = async (app,name,args) => {
    const controller=new AbortController();let timer;
    try {
      const query=app.repo.client.rpc(name,args);
      const result=await Promise.race([
        typeof query.abortSignal==='function'?query.abortSignal(controller.signal):query,
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('A conexão demorou. Reabra este pedido para conferir se foi registrado e tente novamente se necessário.'));},15000);})
      ]);
      if(result.error)throw new Error(result.error.message || 'Não foi possível registrar. Tente novamente.');
      return result.data;
    } finally {clearTimeout(timer);}
  };
  const receiptUrl = id => `https://app.tamoon.app.br/legal/protocolo-exclusao.html#${encodeURIComponent(id)}`;
  const valid = value => value && /^[a-f0-9-]{36}$/i.test(value.id) && ['requested','completed'].includes(value.status) && Number.isFinite(Date.parse(value.due_at));
  function showReceipt(root, receipt) {
    if(!valid(receipt)) throw new Error('O servidor não confirmou o pedido. Tente novamente.');
    try{localStorage.setItem('tamoon-deletion-receipt',receipt.id);}catch{}
    root.innerHTML=`<div class="notice notice-success"><strong>${receipt.status==='completed'?'Exclusão concluída':'Pedido registrado'}</strong><p>${receipt.status==='completed'?'Consulte o protocolo para ver a conclusão e eventuais retenções.':`A equipe processará a exclusão até ${esc(date(receipt.due_at))}. Você não precisa enviar e-mail nem justificar sua decisão.`}</p></div><p>Guarde este protocolo para acompanhar a conclusão mesmo depois de perder o acesso à conta.</p><p class="deletion-protocol">${esc(receipt.id)}</p><a class="btn btn-secondary btn-block" href="${esc(receiptUrl(receipt.id))}" target="_blank" rel="noopener">Acompanhar pedido</a><button type="button" class="btn btn-secondary btn-block" id="copyDeletionReceipt">Copiar link do protocolo</button>`;
    root.querySelector('#copyDeletionReceipt').onclick=async()=>{
      try{await navigator.clipboard.writeText(receiptUrl(receipt.id));root.querySelector('#copyDeletionReceipt').textContent='Link copiado';}
      catch{root.querySelector('#copyDeletionReceipt').textContent='Abra o protocolo para salvar o endereço';}
    };
  }
  window.TamoonDeletion={
    async open(app) {
      // Também funciona na tela de aceite, sem grupo e para usuários bloqueados.
      const previous=document.querySelector('#deletionOverlay');previous?.remove();
      const overlay=document.createElement('div');overlay.id='deletionOverlay';overlay.className='deletion-overlay';
      const priorFocus=document.activeElement;
      overlay.innerHTML=`<section class="deletion-dialog" role="dialog" aria-modal="true" aria-labelledby="deletionTitle"><button class="deletion-close" type="button" aria-label="Fechar">×</button><h2 id="deletionTitle" tabindex="-1">Excluir minha conta do Tâmo On</h2><div id="deletionContent"><p role="status">Consultando sua solicitação…</p></div></section>`;
      document.body.append(overlay);const content=overlay.querySelector('#deletionContent');
      const close=()=>{overlay.remove();priorFocus?.focus();};overlay.querySelector('.deletion-close').onclick=close;
      overlay.addEventListener('keydown',e=>{
        if(e.key==='Escape'){e.preventDefault();close();}
        if(e.key!=='Tab')return;
        const stops=[...overlay.querySelectorAll('button,a[href],input')].filter(x=>!x.disabled);
        if(e.shiftKey&&document.activeElement===stops[0]){e.preventDefault();stops.at(-1).focus();}
        else if(!e.shiftKey&&document.activeElement===stops.at(-1)){e.preventDefault();stops[0].focus();}
      });
      overlay.querySelector('#deletionTitle').focus();
      try{
        const existing=await rpc(app,'get_my_account_deletion_request');
        if(!content.isConnected)return;
        if(existing){showReceipt(content,existing);return;}
        content.innerHTML=`<p>O pedido abrange sua conta do <strong>Tâmo On</strong> e os dados pessoais associados em todo o aplicativo. A equipe concluirá a exclusão em até <strong>30 dias</strong>.</p><ul><li>Seu perfil, vínculos com grupos e inscrições de notificações serão removidos.</li><li>A administração dos seus grupos será transferida; grupos sem outros integrantes serão excluídos.</li><li>Comunicados publicados por você serão removidos. Registros com retenção justificada seguem os prazos da Política de Privacidade.</li></ul><p><a href="https://app.tamoon.app.br/legal/excluir-conta.html" target="_blank" rel="noopener">Ver os dados e prazos de retenção</a></p><p>O pedido não cancela automaticamente reservas, cotas, vouchers ou restituições. A equipe verificará essas situações e informará no protocolo eventuais retenções, com motivo e prazo.</p><p><strong>A exclusão é permanente.</strong> Sua conta Google ou Apple continuará existindo.</p><form id="deletionForm"><label class="legal-check"><input type="checkbox" name="confirm" required><span>Quero excluir permanentemente minha conta do Tâmo On e os dados pessoais associados.</span></label><button type="submit" class="btn btn-danger-outline btn-block">Confirmar solicitação de exclusão</button><p id="deletionStatus" role="status" aria-live="polite"></p></form>`;
        content.querySelector('form').onsubmit=async e=>{
          e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');
          if(button.disabled||!form.elements.confirm.checked)return;
          button.disabled=true;
          try{const saved=await rpc(app,'request_my_account_deletion',{p_confirm:true,p_app_build:app.build});if(content.isConnected)showReceipt(content,saved);}
          catch(error){if(content.isConnected){content.querySelector('#deletionStatus').textContent=error.message;button.disabled=false;}}
        };
      }catch(error){if(content.isConnected)content.innerHTML=`<p role="alert">${esc(error.message)}</p><p>O pedido só será registrado após a confirmação do servidor.</p><button class="btn btn-secondary btn-block" id="retryDeletion">Tentar novamente</button>`;content.querySelector('#retryDeletion')?.addEventListener('click',()=>this.open(app));}
    },
    async admin(app){
      try{
        const rows=await rpc(app,'platform_list_account_deletion_requests');
        app.modal('Pedidos de exclusão',`<p>Conclua os pedidos até o prazo. Cada pedido abrange a conta inteira do Tâmo On. Antes de registrar a conclusão, trate todos os dados associados e os pedidos aplicáveis aos prestadores.</p><p>A revisão abaixo registra trabalho já realizado. A exclusão efetiva continua pelo procedimento administrativo da plataforma, em todo o aplicativo e nos prestadores aplicáveis. Esta fila não exclui contas nem executa cancelamentos ou restituições.</p><div>${rows.map((r,i)=>`<article class="card deletion-review"><strong>${esc(r.email)}</strong><p>Prazo: ${esc(date(r.due_at))}</p><small class="deletion-protocol">${esc(r.id)}</small><form data-review="${i}"><label>Conferência dos dados de quadras e reservas<select name="marketplace" required><option value="">Selecione após verificar</option><option value="not_applicable" ${r.marketplace_review==='not_applicable'?'selected':''}>Verifiquei: não há dados de quadras e reservas associados</option><option value="completed" ${r.marketplace_review==='completed'?'selected':''}>Dados tratados e retenções documentadas</option></select></label><label>Informação para o titular no protocolo<textarea name="notice" required minlength="20" maxlength="3000" rows="4" placeholder="Descreva quais dados foram retidos, o motivo e o prazo ou critério de exclusão. Se não houver retenções, informe. Não inclua dados pessoais, reservas ou credenciais.">${esc(r.retention_notice||'')}</textarea></label><label class="legal-check"><input type="checkbox" name="confirm" required><span>Conferi toda a conta do Tâmo On, incluindo grupos, quadras, reservas e prestadores; tratei os dados aplicáveis e documentei as retenções. Não restam providências externas antes de excluir o acesso.</span></label><button type="submit" class="btn btn-secondary btn-block">Registrar revisão</button></form><button type="button" class="btn btn-danger-outline btn-block" data-delete-request="${i}" ${r.reviewed_at&&r.access_removed?'':'disabled'}>Registrar conclusão</button><p role="status" aria-live="polite">${r.reviewed_at?(r.access_removed?'Acesso removido. A conclusão já pode ser registrada.':'Revisão registrada. Aguarda exclusão administrativa do acesso.'):'Aguardando revisão de toda a conta.'}</p></article>`).join('')||'<p>Nenhum pedido pendente.</p>'}</div>`,root=>{
          root.querySelectorAll('[data-review]').forEach(form=>form.onsubmit=async event=>{
            event.preventDefault();if(!form.reportValidity())return;
            const row=rows[Number(form.dataset.review)],card=form.closest('article'),button=form.querySelector('button'),message=card.querySelector('[role="status"]');
            button.disabled=true;
            try{
              await rpc(app,'platform_review_account_deletion',{p_request_id:row.id,p_marketplace_review:form.elements.marketplace.value,p_retention_notice:form.elements.notice.value,p_confirm:form.elements.confirm.checked});
              card.querySelector('[data-delete-request]').disabled=!row.access_removed;message.textContent='Revisão registrada. Após a exclusão administrativa do acesso, reabra esta fila e registre a conclusão.';
            }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
          });
          root.querySelectorAll('[data-delete-request]').forEach(button=>button.onclick=async()=>{
            const row=rows[Number(button.dataset.deleteRequest)];
            if(!confirm(`Registrar a conclusão do pedido de ${row.email}? Confira se todas as providências documentadas foram realizadas.`))return;
            button.disabled=true;const message=button.parentElement.querySelector('[role="status"]');
            try{await rpc(app,'platform_complete_account_deletion',{p_request_id:row.id});message.textContent='Exclusão concluída. O protocolo confirma a conclusão.';button.parentElement.querySelector('form')?.remove();button.remove();}
            catch(error){message.textContent=error.message;button.disabled=false;}
          });
        });
      }catch(error){app.toast(error.message,true);}
    }
  };
})();
