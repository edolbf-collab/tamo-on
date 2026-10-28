(() => {
  'use strict';
  const input=document.querySelector('#receiptId'),form=document.querySelector('#receiptForm'),output=document.querySelector('#receiptStatus');
  const date=value=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'long'}).format(new Date(value));
  input.value=location.hash.slice(1);
  form.onsubmit=async event=>{
    event?.preventDefault();const receipt=input.value.trim();
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(receipt)){output.textContent='Confira o protocolo informado.';return;}
    const button=form.querySelector('button');button.disabled=true;output.textContent='Consultando…';
    try{
      const c=window.TAMOON_CONFIG;
      const response=await fetch(`${c.supabaseUrl}/rest/v1/rpc/get_account_deletion_receipt`,{method:'POST',headers:{apikey:c.supabasePublishableKey,'content-type':'application/json'},body:JSON.stringify({p_receipt:receipt}),cache:'no-store'});
      if(!response.ok)throw new Error('Não foi possível consultar agora. Tente novamente.');
      const result=await response.json();
      if(!result){output.textContent='Protocolo não encontrado. Confira o código recebido no app.';return;}
      output.textContent=result.status==='completed'?`Exclusão concluída em ${date(result.completed_at)}. A conta foi removida. Retenções justificadas seguem a Política de Privacidade.`:`Pedido recebido em ${date(result.requested_at)}. Prazo para conclusão: ${date(result.due_at)}. Não é necessário enviar e-mail para confirmar.`;
      if(result.status==='completed'&&result.apple_revocation_followup)output.textContent+=' Para remover também a autorização mantida pela Apple, abra Ajustes → seu nome → Iniciar sessão com a Apple → Tâmo On e pare de usar esse acesso. A exclusão da sua conta no Tâmo On já foi concluída.';
      history.replaceState(null,'',`#${receipt}`);
    }catch(error){output.textContent=error.message;}finally{button.disabled=false;}
  };
  if(input.value)form.requestSubmit();
})();
