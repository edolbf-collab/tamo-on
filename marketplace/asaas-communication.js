(() => {
  'use strict';
  let active=null,requestBusy=false,cancelActive=null;
  const dialog=document.createElement('dialog');
  dialog.id='asaasCommunicationDialog';
  dialog.className='asaas-communication';
  dialog.setAttribute('aria-labelledby','asaasCommunicationTitle');
  dialog.setAttribute('aria-describedby','asaasCommunicationMessage');
  dialog.innerHTML='<div class="asaas-communication-content" aria-busy="true"><span class="asaas-communication-spinner" aria-hidden="true"></span><h2 id="asaasCommunicationTitle" tabindex="-1">Comunicando com o Asaas</h2><p id="asaasCommunicationMessage" role="status" aria-live="polite"></p><small>Aguarde a resposta para continuar.</small></div>';
  document.body.appendChild(dialog);
  const message=dialog.querySelector('p'),heading=dialog.querySelector('h2');
  dialog.addEventListener('cancel',event=>event.preventDefault());
  // A different asynchronous dialog must not make the app interactive mid-request.
  for(const type of ['click','dblclick','pointerdown','submit','keydown']){
    document.addEventListener(type,event=>{
      if(!active||window.TamoonMarketplacePilot?.blocked)return;
      event.preventDefault();event.stopImmediatePropagation();
      heading.focus({preventScroll:true});
    },true);
  }
  window.addEventListener('beforeunload',event=>{
    if(active&&!window.TamoonMarketplacePilot?.blocked){event.preventDefault();event.returnValue='';}
  });
  async function flow(label,operation,{background=false}={}){
    if(active)throw new Error('ASAAS_COMMUNICATION_BUSY');
    let timeout,slow,rejectCancelled;
    const focused=document.activeElement;
    const overflow=document.body.style.overflow;
    let valid=true;
    const scope=Object.freeze({
      isActive:()=>valid&&active===scope,
      assertActive:()=>{if(!valid||active!==scope)throw new Error('ASAAS_COMMUNICATION_TIMEOUT');}
    });
    const release=()=>{
      valid=false;clearTimeout(timeout);clearTimeout(slow);
      if(active!==scope)return;
      active=null;requestBusy=false;cancelActive=null;
      if(dialog.open)dialog.close('cancel');
      document.body.style.overflow=overflow;
      if(!window.TamoonMarketplacePilot?.blocked&&!document.querySelector?.('dialog[open]')&&focused?.isConnected)focused.focus?.({preventScroll:true});
    };
    try{
    if(!background){
      active=scope;
      cancelActive=()=>{release();rejectCancelled?.(new Error('ASAAS_COMMUNICATION_CANCELLED'));};
      message.textContent=label;
      document.body.style.overflow='hidden';
      dialog.showModal();heading.focus({preventScroll:true});
      slow=setTimeout(()=>{message.textContent='Aguarde enquanto concluímos sua solicitação.';},12000);
    }
      return await Promise.race([
        Promise.resolve().then(()=>operation(background?null:scope)),
        new Promise((_,reject)=>{rejectCancelled=reject;}),
        new Promise((_,reject)=>{timeout=setTimeout(()=>{valid=false;reject(new Error('ASAAS_COMMUNICATION_TIMEOUT'));},65000);})
      ]);
    }finally{
      clearTimeout(timeout);clearTimeout(slow);
      valid=false;
      if(!background){
        release();
      }
    }
  }
  async function run(label,operation,{background=false,scope=null}={}){
    if(!scope)return flow(label,operation,{background});
    // Only the request explicitly owned by this flow may reuse its modal.
    scope.assertActive();
    if(scope!==active||background||requestBusy)throw new Error('ASAAS_COMMUNICATION_BUSY');
    requestBusy=true;message.textContent=label;
    try{const result=await operation();scope.assertActive();return result;}
    finally{if(active===scope)requestBusy=false;}
  }
  window.MarketplaceAsaasCommunication={run,flow,isBusy:()=>Boolean(active),cancel:()=>cancelActive?.()};
})();
