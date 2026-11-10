// Follow the same close/leave handlers as the visible controls before leaving the app.
export async function nativeBack({document,app,marketplace,location,history,canGoBack,minimize}) {
  const dialogs=[...document.querySelectorAll('dialog[open]')];
  const dialog=dialogs.at(-1);
  if(dialog){
    if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close('cancel');
    return;
  }
  const close=document.querySelector('#modalRoot .modal-close');
  if(close){close.click();return;}
  if(location.pathname.startsWith('/marketplace/')){
    if(marketplace?.leave)await marketplace.leave();else location.assign('/');
    return;
  }
  if(app?.ready&&app.route!=='home'){app.route='home';app.render();return;}
  if(canGoBack)history.back();else await minimize();
}
