(() => {
  'use strict';
  document.querySelector('#legalPrint')?.addEventListener('click', () => window.print());
  const field = document.querySelector('[data-legal-effective]');
  const config = window.TAMOON_CONFIG;
  if (!field || !config?.supabaseUrl || !config?.supabasePublishableKey) return;
  fetch(`${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/get_community_legal_document`, {
    method: 'POST', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({p_document_type:field.dataset.legalEffective,p_version:'1.2'}), cache: 'no-store'
  }).then(response => response.ok ? response.json() : Promise.reject()).then(doc => {
    if (doc?.effective_at) field.textContent = `Vigência: ${new Intl.DateTimeFormat('pt-BR', {dateStyle:'long', timeZone:'America/Sao_Paulo'}).format(new Date(doc.effective_at))}`;
  }).catch(() => {});
})();
