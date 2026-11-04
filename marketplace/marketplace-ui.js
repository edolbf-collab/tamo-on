(() => {
  'use strict';
  // Patch only changed DOM nodes. Forms/dialogs outside #app keep their own lifecycle.
  const key=node=>node.nodeType===1 ? node.id || node.getAttribute('data-ui-key') || '' : '';
  function compatible(a,b){return a.nodeType===b.nodeType && (a.nodeType!==1 || (a.tagName===b.tagName && key(a)===key(b)));}
  function patch(current,next){
    if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
    const active=current===document.activeElement;
    const editing=active && current.matches('input:not([type=checkbox]):not([type=radio]),textarea');
    const retainDraft=editing && current.getAttribute('value')===next.getAttribute('value') && (current.tagName!=='TEXTAREA'||current.defaultValue===next.defaultValue);
    const draft=retainDraft?current.value:null;
    const selection=retainDraft?[current.selectionStart,current.selectionEnd]:null;
    const detailsOpen=current.tagName==='DETAILS'?current.open:null;
    for(const attribute of [...current.attributes])if(!next.hasAttribute(attribute.name) && !(attribute.name==='open'&&detailsOpen!==null))current.removeAttribute(attribute.name);
    for(const attribute of next.attributes)if(!(attribute.name==='open'&&detailsOpen!==null)&&current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value);
    children(current,next);
    if(current.tagName==='INPUT'){
      if(!retainDraft && current.type!=='file' && current.value!==next.value)current.value=next.value;
      if(['checkbox','radio'].includes(current.type))current.checked=next.checked;
      current.disabled=next.disabled;
    }else if(current.tagName==='TEXTAREA' && !retainDraft)current.value=next.value;
    else if(current.tagName==='SELECT' && !active)current.value=next.value;
    if(retainDraft){current.value=draft;try{current.setSelectionRange(...selection);}catch(_) {}}
    if(detailsOpen!==null)current.open=detailsOpen;
  }
  function children(current,next){
    const keyed=new Map([...current.childNodes].filter(node=>key(node)).map(node=>[key(node),node]));
    let cursor=current.firstChild;
    for(const fresh of [...next.childNodes]){
      let existing=key(fresh)?keyed.get(key(fresh)):cursor;
      if(existing && compatible(existing,fresh)){
        if(existing!==cursor)current.insertBefore(existing,cursor);
        patch(existing,fresh);cursor=existing.nextSibling;
      }else{
        const inserted=fresh.cloneNode(true);current.insertBefore(inserted,cursor);
      }
    }
    while(cursor){const following=cursor.nextSibling;current.removeChild(cursor);cursor=following;}
  }
  function update(root,markup){
    if(root.marketplaceMarkup===markup)return false;
    const template=document.createElement('template');template.innerHTML=markup;
    children(root,template.content);root.marketplaceMarkup=markup;return true;
  }
  window.MarketplaceUI={update};
})();
