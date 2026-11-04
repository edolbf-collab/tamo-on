(() => {
 'use strict';
 let cleanup=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function stop(){if(cleanup)cleanup();cleanup=null;}
 function mount({dialog,body,result,reservation,identity,isCurrent,refresh,onPayer,money,toast,receivedAt=performance.now()}){
  stop();
  const current=()=>dialog.open&&dialog.dataset.view==='asaas-payment'&&dialog.dataset.paymentIdentity===identity&&isCurrent();
  let interval=null,refreshing=false,closed=false;
  const clear=()=>{if(closed)return;closed=true;clearInterval(interval);dialog.removeEventListener('close',clear);body.querySelectorAll('input,textarea').forEach(x=>x.value='');body.replaceChildren();};
  cleanup=clear;dialog.addEventListener('close',clear,{once:true});
  if(result.mode==='asaas_pix_payer_required'){
   body.innerHTML=`<p>Informe os dados do pagador para gerar o Pix. O endereço não é necessário.</p><div class="inline-pix-payer"><label>Nome completo<input name="pixPayerName" autocomplete="name" maxlength="120" required value="${esc(result.payerName)}"></label><label>CPF ou CNPJ<input name="pixPayerTaxId" inputmode="numeric" autocomplete="off" maxlength="18" required placeholder="Somente números"></label><p class="muted">Os dados são enviados ao Asaas para identificar o pagamento.</p><button class="button primary" type="button" data-pix-generate>Gerar Pix</button></div>`;
   const button=body.querySelector('[data-pix-generate]'),name=body.querySelector('[name=pixPayerName]'),tax=body.querySelector('[name=pixPayerTaxId]');
   const generate=async()=>{if(button.disabled||!current())return;if(!name.reportValidity()||!tax.reportValidity())return;
    const payer={name:name.value.trim(),cpfCnpj:tax.value.trim()};button.disabled=true;tax.value='';
    try{await onPayer(payer);}finally{payer.cpfCnpj='';if(button.isConnected)button.disabled=false;}
   };
   button.addEventListener('click',generate);
   for(const input of [name,tax])input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();generate();}});
   interval=setInterval(()=>{if(!current())stop();},500);return;
  }
  if(result.mode!=='asaas_pix'||result.status!=='pending'||!Number.isFinite(Number(result.amount))||Number(result.amount)<=0
   ||!/^iVBOR[0-9A-Za-z+/=]+$/.test(result.encodedImage||'')||result.encodedImage.length>500000
   ||typeof result.payload!=='string'||!result.payload.startsWith('000201')||result.payload.length>4096
   ||!Number.isFinite(Date.parse(result.dueAt))||!Number.isFinite(Date.parse(result.serverNow)))throw new Error('PIX_QR_INVALID');
  const remaining=Math.max(0,Date.parse(result.dueAt)-Date.parse(result.serverNow));
  const deadline=receivedAt+remaining;
  body.innerHTML=`<div class="inline-pix"><p class="inline-pix-total"><strong>${esc(reservation.id)} · ${esc(money(Number(result.amount)))}</strong><br><span>${reservation.pixSplit?'Sua cota Pix':'Pagamento integral por Pix'}</span></p><p>Prazo restante da reserva: <strong data-pix-clock></strong></p><div data-pix-payment><img class="inline-pix-qr" alt="QR Code para pagamento por Pix no Sandbox" src="data:image/png;base64,${result.encodedImage}"><label>Pix Copia e Cola<textarea readonly rows="3" aria-label="Pix Copia e Cola">${esc(result.payload)}</textarea></label><button class="button primary full" type="button" data-pix-copy>Copiar código Pix</button><p class="inline-pix-copy-feedback" role="status" aria-live="polite" aria-atomic="true" data-pix-copy-feedback></p></div><p role="status" aria-live="polite" data-pix-status>Aguardando a confirmação do pagamento.</p><p class="muted">${reservation.pixSplit?'Somente a sua cota será paga. A reserva será confirmada quando o total for recolhido.':'A reserva será atualizada após a confirmação do pagamento.'}</p><p class="muted">Ambiente de homologação Asaas. Não utilize dinheiro real.</p></div>`;
  const code=body.querySelector('textarea'),button=body.querySelector('[data-pix-copy]'),status=body.querySelector('[data-pix-status]'),clock=body.querySelector('[data-pix-clock]'),payment=body.querySelector('[data-pix-payment]');
  const copyFeedback=body.querySelector('[data-pix-copy-feedback]');
  const canShowCopy=()=>!closed&&current()&&button.isConnected&&performance.now()<deadline;
  button.addEventListener('click',async()=>{if(button.disabled||!canShowCopy())return;
   button.disabled=true;button.textContent='Copiando…';copyFeedback.textContent='';
   try{
    await navigator.clipboard.writeText(code.value);
    if(canShowCopy()){button.textContent='Código Pix copiado!';copyFeedback.textContent='Cole o código no aplicativo do seu banco para pagar.';}
   } catch {
    if(canShowCopy()){button.textContent='Copiar código Pix';code.focus();code.select();copyFeedback.textContent='Não foi possível copiar automaticamente. Copie o código selecionado.';}
   } finally {if(button.isConnected)button.disabled=false;}
  });
  let lastRefresh=0,expired=false,refreshDelay=8000;
  const tick=()=>{
   if(!current()){stop();return;}
   const ms=deadline-performance.now(),sec=Math.max(0,Math.ceil(ms/1000));clock.textContent=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
   if(ms<=0&&!expired){expired=true;payment.hidden=true;code.value='';status.textContent='O prazo da reserva terminou. Aguarde a atualização da situação do pagamento.';}
   if(!document.hidden&&!refreshing&&performance.now()-lastRefresh>=refreshDelay){
    lastRefresh=performance.now();refreshing=true;
    Promise.resolve().then(refresh).then(()=>{refreshDelay=8000;}).catch(()=>{refreshDelay=Math.min(refreshDelay*2,30000);})
     .finally(()=>{refreshing=false;lastRefresh=performance.now();});
   }
  };
  interval=setInterval(tick,500);tick();
 }
 window.MarketplaceInlinePix={mount,stop};
})();
