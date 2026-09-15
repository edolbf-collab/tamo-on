(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => value ? new Intl.DateTimeFormat('pt-BR', {dateStyle:'long', timeZone:'America/Sao_Paulo'}).format(new Date(value)) : 'A definir na ativação';
  const statements = {terms:'Li e concordo com os Termos de Uso.',conduct:'Li e concordo com o Código de Conduta, Moderação e Banimento.',privacy:'Declaro que li a Política de Privacidade e Uso de Dados.'};
  const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const validate = async status => {
    if (!status || typeof status.enabled !== 'boolean' || typeof status.allowed !== 'boolean' || !Array.isArray(status.documents)) throw new Error('Não foi possível conferir os documentos. Tente novamente.');
    if (status.documents.length !== 3 || new Set(status.documents.map(d=>d.document_type)).size !== 3) throw new Error('Os três documentos obrigatórios não estão disponíveis.');
    for (const doc of status.documents) {
      if (!statements[doc.document_type] || await hash(doc.content_html) !== doc.content_hash) throw new Error('O conteúdo do documento não corresponde à versão oficial. Recarregue a página.');
      // Apenas HTML editorial gerado a partir dos DOCX; rejeitar conteúdo ativo.
      const parsed = new DOMParser().parseFromString(doc.content_html,'text/html');
      if ([...parsed.body.querySelectorAll('*')].some(el => !['H2','P','DIV','TABLE','TR','TBODY','THEAD','TH','TD','BR'].includes(el.tagName) || [...el.attributes].some(a=>!['class','tabindex'].includes(a.name)))) throw new Error('Formato de documento inválido.');
    }
    return status;
  };
  const documentsHtml = docs => docs.map(d=>`<details><summary>${esc(d.title)} · v${esc(d.version)}</summary><p class="legal-meta">Vigência: ${esc(date(d.effective_at))}</p><article class="legal-document">${d.content_html}</article><p><a href="${esc(d.public_url)}" target="_blank" rel="noopener">Abrir para imprimir ou salvar</a></p></details>`).join('');
  const download = (data,name) => {
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const signOut = async repo => { await repo.signOut(); window.location.replace(new URL('./',document.baseURI).href); };
  window.TamoonLegal = {
    validate,
    async mountGate(app,status) {
      app.ready=false;
      clearInterval(app.accessCheckTimer);clearInterval(app.matchTimelineTimer);
      clearTimeout(app.repo.reloadTimer);clearTimeout(app.repo.notificationReloadTimer);
      if(app.repo.channel){await app.repo.client.removeChannel(app.repo.channel);app.repo.channel=null;app.repo.subscribedGroupId=null;}
      if(app.repo.notificationChannel){await app.repo.client.removeChannel(app.repo.notificationChannel);app.repo.notificationChannel=null;}
      const profile=app.repo.state.profile;
      app.repo.state=app.emptyLegalState(profile);app.state=app.repo.state;
      // A tela inteira é substituída, sem rotas ou modal que contornem o bloqueio.
      document.body.innerHTML=`<main class="auth-screen"><section class="legal-gate legal-center"><img class="auth-brand-logo" src="/brand/tamo-on-logo-horizontal-negative.svg" alt="Tâmo On"><h1>Antes de continuar</h1><p>O Tâmo On é exclusivo para pessoas com <strong>18 anos completos ou mais</strong>.</p><p>Leia os documentos abaixo e confirme as declarações. Você poderá consultá-los novamente em <strong>Documentos e privacidade</strong>.</p><div id="legalGateContent"><p role="status">Conferindo os documentos…</p></div><button type="button" id="legalSignOut" class="btn btn-secondary btn-block">Sair da conta</button><p class="legal-muted">Precisa de ajuda? <a href="mailto:suporte@tamoon.app.br">suporte@tamoon.app.br</a></p></section></main>`;
      document.querySelector('#legalSignOut').addEventListener('click',async()=>{try{await signOut(app.repo);}catch(e){document.querySelector('#legalGateContent').textContent=e.message;}});
      const target=document.querySelector('#legalGateContent');
      try {
        await validate(status);
        if (!status.enabled) { window.location.reload(); return; }
        target.innerHTML=`${documentsHtml(status.documents)}<form id="legalAcceptanceForm"><fieldset><legend>Confirmação de maioridade</legend><label class="legal-check"><input type="radio" name="age" value="adult" required><span>Declaro ter 18 anos completos ou mais.</span></label><label class="legal-check"><input type="radio" name="age" value="minor"><span>Tenho menos de 18 anos.</span></label></fieldset><p id="legalAgeError" class="legal-status" role="alert" hidden>O uso do Tâmo On é permitido somente a pessoas com 18 anos completos ou mais. Você pode consultar os documentos ou sair da conta.</p>${['terms','conduct','privacy'].map(type=>`<label class="legal-check"><input type="checkbox" name="${type}" required><span>${statements[type]}</span></label>`).join('')}<p class="legal-muted">As notificações no celular são opcionais e configuradas separadamente.</p><p id="legalSubmitStatus" class="legal-status" role="status" aria-live="polite"></p><button id="legalAcceptButton" class="btn btn-primary btn-block" type="submit" disabled>Aceitar e continuar</button></form>`;
        const form=target.querySelector('form'), button=target.querySelector('#legalAcceptButton'),message=target.querySelector('#legalSubmitStatus');
        let submitting=false;
        const complete=()=>form.elements.age.value==='adult' && ['terms','privacy','conduct'].every(type=>form.elements[type].checked);
        form.addEventListener('change',()=>{button.disabled=submitting || !complete();target.querySelector('#legalAgeError').hidden=form.elements.age.value!=='minor';});
        form.addEventListener('submit',async event=>{
          event.preventDefault();if(submitting || button.disabled || !complete())return;
          submitting=true;
          button.disabled=true;button.textContent='Registrando…';message.textContent='';
          try {
            const {data,error}=await app.repo.client.rpc('accept_community_legal_documents',{
              p_documents:status.documents.map(d=>({id:d.id,version:d.version,content_hash:d.content_hash})),
              p_adult:form.elements.age.value==='adult',p_terms:form.elements.terms.checked,p_privacy:form.elements.privacy.checked,p_conduct:form.elements.conduct.checked,
              p_app_build:157,p_source:window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone===true ? 'pwa':'web'
            });
            if(error)throw error;if(!data?.allowed)throw new Error('O aceite não foi confirmado. Tente novamente.');
            window.location.reload();
          }catch(error){submitting=false;message.textContent=error.message || 'Não foi possível registrar. Confira sua conexão e tente novamente.';button.disabled=!complete();button.textContent='Aceitar e continuar';
            if(/atualizados|vigentes indisponíveis/.test(error.message||'')) {button.disabled=true;message.insertAdjacentHTML('beforeend',' <a href="">Reabrir os documentos</a>');}
          }
        });
      } catch(error) {
        target.innerHTML=`<p class="legal-status" role="alert">${esc(error.message)}</p><button id="legalRetry" type="button" class="btn btn-primary">Tentar novamente</button>`;
        target.querySelector('#legalRetry').addEventListener('click',()=>location.reload());
      }
    },
    async openCenter(app) {
      const {data,error}=await app.repo.client.rpc('get_community_legal_status');if(error)throw error;await validate(data);
      app.modal('Documentos e privacidade',`<div class="legal-center"><p>Uso exclusivo para pessoas com <strong>18 anos completos ou mais</strong>.</p>${data.enabled?'':'<p class="legal-meta">Textos preparados para publicação. A vigência ainda será definida.</p>'}${documentsHtml(data.documents)}<p>Dados pessoais e pedidos LGPD: <a href="mailto:privacidade@tamoon.app.br">privacidade@tamoon.app.br</a></p><p>Suporte e moderação: <a href="mailto:suporte@tamoon.app.br">suporte@tamoon.app.br</a></p><button class="btn btn-secondary btn-block" id="downloadLegalReceipt">Baixar meus registros de aceite</button>${app.state.is_platform_admin?'<details><summary>Auditoria de aceites</summary><form id="legalAuditForm" class="form-grid"><div class="field"><label>Identificador do usuário (UUID)</label><input name="user_id" required placeholder="UUID do usuário" pattern="[a-fA-F0-9-]{36}"></div><div class="field"><label>Motivo da consulta</label><input name="purpose" required minlength="10" maxlength="500"></div><button class="btn btn-secondary" type="submit">Exportar registros</button></form><p class="legal-meta">Consulta restrita à administração e registrada para auditoria.</p></details>':''}<p id="legalCenterStatus" class="legal-status" role="status"></p></div>`,root=>{
        root.querySelector('#downloadLegalReceipt').addEventListener('click',async event=>{
          event.currentTarget.disabled=true;
          try{const {data,error}=await app.repo.client.rpc('export_my_legal_acceptances');if(error)throw error;download(data,'tamo-on-meus-aceites.json');}
          catch(e){root.querySelector('#legalCenterStatus').textContent=e.message;}finally{root.querySelector('#downloadLegalReceipt').disabled=false;}
        });
        root.querySelector('#legalAuditForm')?.addEventListener('submit',async event=>{
          event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
          try{const {data,error}=await app.repo.client.rpc('platform_export_legal_acceptances',{p_user_id:form.elements.user_id.value.trim(),p_purpose:form.elements.purpose.value.trim()});if(error)throw error;download(data,'tamo-on-auditoria-aceites.json');}
          catch(e){root.querySelector('#legalCenterStatus').textContent=e.message;}finally{button.disabled=false;}
        });
      });
    }
  };
})();
