/* Push registration health is separate from notification display on the device. */
(function(root){
  'use strict';
  // Query the registration as well as the synchronous Notification snapshot.
  // Android TWA permission is delegated to the installed app. Never infer a
  // grant from an existing subscription or remember a previous request result.
  async function readPermission({manager,notification,key}) {
    let pushPermission=null;
    let queryFailed=false;
    if(typeof manager?.permissionState==='function') {
      let timer;
      try {
        pushPermission=await Promise.race([
          manager.permissionState({userVisibleOnly:true,...(key?{applicationServerKey:key}:{})}),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('permission timeout')),3000);})
        ]);
      } catch {queryFailed=true;} finally {clearTimeout(timer);}
    }
    const notificationPermission=notification?.permission||'default';
    // An explicit denial from either source must remain visible.
    const permission=notificationPermission==='denied'||pushPermission==='denied'?'denied'
      :pushPermission==='granted'?'granted'
      :pushPermission==='prompt'?'default':notificationPermission;
    return {permission,notificationPermission,pushPermission,queryFailed};
  }
  function needsRenewal(subscription,record,key,now=Date.now()) {
    if(!subscription)return false;
    if(record?.invalidated_at || (subscription.expirationTime!=null&&subscription.expirationTime<=now))return true;
    const existing=subscription.options?.applicationServerKey;
    if(!existing)return false;
    const bytes=new Uint8Array(existing);
    return bytes.length!==key.length||bytes.some((value,i)=>value!==key[i]);
  }
  const pending=new WeakSet();
  async function register(options) {
    const {manager}=options;
    if(pending.has(manager))throw Error("Uma ativação já está em andamento. Aguarde e tente novamente.");
    pending.add(manager);
    try{return await registerOnce(options);}finally{pending.delete(manager);}
  }
  async function registerOnce({manager,key,record,force=false,save,remove,assertAccount=()=>{}}) {
    assertAccount();
    let subscription=await manager.getSubscription();assertAccount();
    const previous=subscription;
    if(subscription&&(force||needsRenewal(subscription,record,key))) {
      await subscription.unsubscribe();assertAccount();
      if(await manager.getSubscription())throw Error('Não foi possível renovar o vínculo. Feche e reabra o app antes de tentar novamente.');
      subscription=null;
    }
    if(!subscription)subscription=await manager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    assertAccount();await save(subscription);assertAccount();
    if(previous&&previous.endpoint!==subscription.endpoint)await remove(previous.endpoint);
    return subscription;
  }
  function diagnostic({nativeStatus,native=false,supported,permission,subscription,record,error=false}) {
    if(error)return {tone:'warn',label:'Não foi possível verificar'};
    if(native)return nativeStatus?.active?{tone:'ok',label:`Vinculado · ${nativeStatus.provider||'Apple'}`}:{tone:'warn',label:nativeStatus?.permission==='denied'?'Bloqueado nos ajustes':'Não vinculado'};
    if(!supported)return {tone:'warn',label:'Não suportado'};
    if(permission!=='granted')return {tone:'warn',label:permission==='denied'?'Bloqueado nos ajustes':'Permissão pendente'};
    if(!subscription||!record?.enabled||record.invalidated_at)return {tone:'warn',label:'Vínculo pendente'};
    if(Number(record.consecutive_failures)>0)return {tone:'warn',label:'Falha recente no envio'};
    return {tone:'ok',label:'Vinculado · exibição não confirmada'};
  }
  root.TamoonPushClient={needsRenewal,register,diagnostic,readPermission};
})(typeof window==='undefined'?globalThis:window);
