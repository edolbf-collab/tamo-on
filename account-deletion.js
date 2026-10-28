(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => new Intl.DateTimeFormat('pt-BR',{dateStyle:'long'}).format(new Date(value));
  const rpc = async (app,name,args) => {
    const {data,error}=await app.repo.client.rpc(name,args);
    if(error) throw new Error(error.message || 'Não foi possível registrar. Tente novamente.');
    return data;
  };
  const receiptUrl = id => `https://app.tamoon.app.br/legal/protocolo-exclusao.html#${encodeURIComponent(id)}`;
  const valid = value => value && /^[a-f0-9-]{36}$/i.test(value.id) && ['requested','completed'].includes(value.status) && Number.isFinite(Date.parse(value.due_at));
  function showReceipt(root, receipt) {
    if(!valid(receipt)) throw new Error('O servidor não confirmou o pedido. Tente novamente.');
    localStorage.setItem('tamoon-deletion-receipt',receipt.id);
    root.innerHTML=`<div class="notice notice-success"><strong>Pedido registrado</strong><p>A exclusão será processada até ${esc(date(receipt.due_at))}. Você não precisa enviar e-mail nem justificar sua decisão.</p></div><p>Guarde este protocolo para acompanhar a conclusão mesmo depois de perder o acesso à conta.</p><p class="deletion-protocol">${esc(receipt.id)}</p><a class="btn btn-secondary btn-block" href="${esc(receiptUrl(receipt.id))}" target="_blank" rel="noopener">Acompanhar pedido</a><button type="button" class="btn btn-secondary btn-block" id="copyDeletionReceipt">Copiar link do protocolo</button>`;
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
      overlay.innerHTML=`<section class="deletion-dialog" role="dialog" aria-modal="true" aria-labelledby="deletionTitle"><button class="deletion-close" type="button" aria-label="Fechar">×</button><h2 id="deletionTitle" tabindex="-1">Excluir minha conta</h2><div id="deletionContent"><p role="status">Consultando sua solicitação…</p></div></section>`;
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
        content.innerHTML=`<p>O pedido abrange sua conta e os dados pessoais associados. A equipe concluirá a exclusão em até <strong>30 dias</strong>.</p><ul><li>Seu perfil, vínculos com grupos e inscrições de notificações serão removidos.</li><li>A administração dos seus grupos será transferida; grupos sem outros integrantes serão excluídos.</li><li>Comunicados publicados por você serão removidos. Registros com retenção justificada seguem os prazos da Política de Privacidade.</li></ul><p><a href="https://app.tamoon.app.br/legal/excluir-conta.html" target="_blank" rel="noopener">Ver os dados e prazos de retenção</a></p><p><strong>A exclusão é permanente.</strong> Sua conta Google ou Apple continuará existindo.</p><form id="deletionForm"><label class="legal-check"><input type="checkbox" name="confirm" required><span>Quero excluir permanentemente minha conta e os dados pessoais associados.</span></label><button type="submit" class="btn btn-danger-outline btn-block">Confirmar solicitação de exclusão</button><p id="deletionStatus" role="status" aria-live="polite"></p></form>`;
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
        app.modal('Pedidos de exclusão',`<p>Conclua cada pedido até a data indicada. O protocolo é atualizado automaticamente após a exclusão da conta.</p><div>${rows.map((r,i)=>`<article class="card"><strong>${esc(r.email)}</strong><p>Prazo: ${esc(date(r.due_at))}</p><small class="deletion-protocol">${esc(r.id)}</small><button type="button" class="btn btn-danger-outline btn-block" data-delete-request="${i}">Concluir exclusão permanente</button><p role="status"></p></article>`).join('')||'<p>Nenhum pedido pendente.</p>'}</div>`,root=>{
          root.querySelectorAll('[data-delete-request]').forEach(button=>button.onclick=async()=>{
            const row=rows[Number(button.dataset.deleteRequest)];
            if(!confirm(`Excluir permanentemente a conta ${row.email}? A operação também pode transferir ou excluir grupos.`))return;
            button.disabled=true;const message=button.parentElement.querySelector('[role="status"]');
            try{await app.repo.deleteBetaUserPermanently(row.email);message.textContent='Exclusão concluída. O protocolo confirma a conclusão.';button.remove();}
            catch(error){message.textContent=error.message;button.disabled=false;}
          });
        });
      }catch(error){app.toast(error.message,true);}
    }
  };
})();
