(() => {
  const config = window.TAMO_ON_SITE_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const status = document.getElementById('downloadStatus');

  if (params.has('invite')) {
    const code = String(params.get('invite') || '').trim().toUpperCase();
    if (params.getAll('invite').length !== 1 || !/^[A-F0-9]{8}$/.test(code)) {
      if (status) status.textContent = 'Este convite está incompleto ou inválido. Peça um novo link ao administrador do grupo.';
      return;
    }
    const stores = document.querySelector('.download-page .store-links');
    if (!stores) return;
    const nativeUrl = `br.app.tamoon://invite?code=${encodeURIComponent(code)}`;
    const webUrl = `https://app.tamoon.app.br/?invite=${encodeURIComponent(code)}`;

    const style = document.createElement('style');
    style.textContent = '.group-invite{box-sizing:border-box;max-width:540px;margin:28px auto;padding:24px;border:1px solid #234e3d;border-radius:20px;background:#0b2c24;color:#fff}.group-invite h2{margin:0 0 14px;font-size:24px}.group-invite p{font-size:15px;line-height:1.6;color:#d5e7dc}.group-invite label{display:block;font-size:13px;color:#d5e7dc}.group-invite input{box-sizing:border-box;display:block;width:100%;margin:8px 0 14px;padding:12px;border:1px solid #789187;border-radius:10px;background:#06110e;color:#fff;font:700 28px monospace;letter-spacing:3px;text-align:center}.group-invite .invite-actions{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}.group-invite .invite-action{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 18px;border:1px solid #789187;border-radius:12px;background:#06110e;color:#fff;font-family:inherit;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer}.group-invite .invite-open{background:#1ed17a;color:#06110e;border-color:#1ed17a}.group-invite .invite-feedback{min-height:24px;margin-bottom:0}.download-qr[hidden]{display:none}@media(max-width:420px){.group-invite{padding:18px}.group-invite .invite-action{width:100%}}';
    document.head.append(style);
    const card = document.createElement('section');
    card.className = 'group-invite';
    card.setAttribute('aria-labelledby', 'inviteTitle');
    // Static markup only; the invitation value is assigned through DOM properties.
    card.innerHTML = '<h2 id="inviteTitle">Você recebeu um convite!</h2><label for="inviteCode">Código do grupo</label><input id="inviteCode" readonly aria-label="Código de convite do grupo"><div class="invite-actions"><a class="invite-action invite-open">Abrir convite no app</a><button type="button" class="invite-action invite-copy">Copiar código</button></div><p>Já tem o Tâmo On? Abra o convite no app. Se ainda não tem, baixe pela loja abaixo e depois volte a este link.</p><p>Você também pode informar este código em <strong>Entrar em um grupo</strong>, dentro do aplicativo.</p><p class="invite-feedback" role="status" aria-live="polite"></p>';
    const input = card.querySelector('input');
    input.value = code;
    const open = card.querySelector('.invite-open');
    open.href = nativeUrl;
    const feedback = card.querySelector('.invite-feedback');
    open.addEventListener('click', () => {
      feedback.textContent = 'Se o app não abrir, instale ou atualize pela loja abaixo. Depois, use este código para entrar no grupo.';
    });
    card.querySelector('.invite-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code);
        feedback.textContent = 'Código copiado.';
      } catch {
        input.focus();
        input.select();
        feedback.textContent = 'Toque e segure o código selecionado para copiar.';
      }
    });
    stores.before(card);
    if (status) status.textContent = 'Depois da instalação, volte a este convite ou use o código no aplicativo.';
    const header = document.querySelector('.header-cta');
    if (header) { header.href = nativeUrl; header.textContent = 'Abrir convite'; }
    const web = document.querySelector('.download-page .inline-guide-link');
    if (web) { web.href = webUrl; web.textContent = 'Continuar com este convite no navegador →'; }
    // The generic download QR has no group code. Hide it to avoid losing the invite.
    const qr = document.querySelector('.download-qr');
    if (qr) qr.hidden = true;
    return;
  }

  // Keep the original QR flow for downloads without a group invitation.
  if (params.has('escolher')) return;
  const ua = navigator.userAgent || '';
  const target = /iPhone|iPod/.test(ua) ? config.iosUrl : /Android/i.test(ua) ? config.androidUrl : '';
  if (!target) return;
  if (status) status.textContent = 'Abrindo a loja do seu celular… Se ela não abrir, use um dos botões acima.';
  window.setTimeout(() => location.replace(target), 1100);
})();
