(() => {
  'use strict';
  // Move the existing preference controls, preserving their handlers and state.
  function create({onNavigate}) {
    const button=document.getElementById('openMarketplaceMenu');
    const dialog=document.getElementById('marketplaceMenu');
    const links=document.getElementById('marketplaceMenuLinks');
    const title=document.getElementById('marketplaceMenuTitle');
    const preferences=document.getElementById('marketplaceMenuPreferences');
    const closeButton=document.getElementById('closeMarketplaceMenu');
    const header=document.querySelector('.app-header');
    const ribbon=document.querySelector('.sandbox-ribbon');
    const mobile=window.matchMedia('(max-width: 980px)');
    if(!button||!dialog||!links||!preferences||!header)return {update(){}};
    const controls=['toggleNotificationSound','toggleMarketplaceTheme','openReleaseNotes'].map(id=>{
      const element=document.getElementById(id);
      if(!element)return null;
      const anchor=document.createComment('Header control: '+id);
      element.before(anchor);
      return {element,anchor};
    }).filter(Boolean);
    let enabled=false, currentTitle='', scrollState=null;
    const available=()=>enabled&&!document.body.classList.contains('pilot-locked')&&!document.body.classList.contains('pilot-leaving');
    function measure() {
      document.documentElement.style.setProperty('--marketplace-ribbon-height',(ribbon?.getBoundingClientRect().height||0)+'px');
      if(!scrollState)dialog.style.setProperty('--marketplace-menu-top',Math.max(0,header.getBoundingClientRect().bottom)+'px');
    }
    function release(restoreFocus=true) {
      if(!scrollState)return;
      const previous=scrollState;scrollState=null;
      for(const [name,value] of Object.entries(previous.styles))document.body.style[name]=value;
      const root=document.documentElement, behavior=root.style.scrollBehavior;
      root.style.scrollBehavior='auto';window.scrollTo(previous.x,previous.y);root.style.scrollBehavior=behavior;
      button.setAttribute('aria-expanded','false');
      if(restoreFocus&&mobile.matches&&available()&&!document.querySelector('dialog[open]'))button.focus({preventScroll:true});
    }
    function close(restoreFocus=true) {
      if(dialog.open)dialog.close();
      release(restoreFocus);
    }
    function open() {
      if(!mobile.matches||!available()||dialog.open||document.querySelector('dialog[open]'))return;
      measure();
      const styles={};
      for(const name of ['position','top','left','right','width','overflow'])styles[name]=document.body.style[name];
      scrollState={x:window.scrollX,y:window.scrollY,styles};
      Object.assign(document.body.style,{position:'fixed',top:-scrollState.y+'px',left:'0',right:'0',width:'100%',overflow:'hidden'});
      try{dialog.showModal();}catch(error){release();throw error;}
      button.setAttribute('aria-expanded','true');
      closeButton.focus({preventScroll:true});
    }
    function syncViewport() {
      const wasOpen=dialog.open;
      if(!mobile.matches)close(false);
      for(const {element,anchor} of controls){
        if(mobile.matches){if(element.parentElement!==preferences)preferences.append(element);}
        else if(element.previousSibling!==anchor)anchor.after(element);
      }
      measure();
      if(wasOpen&&!mobile.matches)document.getElementById('app')?.focus({preventScroll:true});
    }
    function syncAccess() {
      button.disabled=!available();
      if(!available())close(false);
    }
    function update({heading,markup='',allowed=true}) {
      enabled=allowed;
      if(currentTitle!==heading)close(false);
      currentTitle=heading;title.textContent=heading;
      links.setAttribute('aria-label','Menu da área '+heading);
      if(window.MarketplaceUI)window.MarketplaceUI.update(links,markup);
      else if(links.innerHTML!==markup)links.innerHTML=markup;
      links.hidden=!markup;
      syncAccess();
    }
    button.addEventListener('click',()=>dialog.open?close():open());
    closeButton.addEventListener('click',()=>close());
    dialog.addEventListener('click',event=>{if(event.target===dialog)close();});
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('close',()=>{if(!dialog.open)release();});
    links.addEventListener('click',async event=>{
      const target=event.target.closest('[data-nav]');
      if(!target||target.disabled||!available())return;
      event.preventDefault();close(false);
      await onNavigate(target.dataset.nav);
      if(available()&&!document.querySelector('dialog[open]'))document.getElementById('app')?.focus({preventScroll:true});
    });
    // Help opens its own dialog; restore scrolling before handing over focus.
    preferences.addEventListener('click',event=>{if(event.target.closest('#openReleaseNotes'))close(false);},true);
    mobile.addEventListener('change',syncViewport);
    window.addEventListener('resize',measure);
    window.addEventListener('pagehide',()=>close(false));
    if(window.ResizeObserver&&ribbon)new ResizeObserver(measure).observe(ribbon);
    new MutationObserver(syncAccess).observe(document.body,{attributes:true,attributeFilter:['class']});
    button.hidden=false;
    document.body.classList.add('marketplace-navigation-ready');
    syncViewport();syncAccess();
    return {update,close};
  }
  window.MarketplaceNavigation={create};
})();
