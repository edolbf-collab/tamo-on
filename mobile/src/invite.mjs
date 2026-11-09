// Invitations never authenticate or join a group. They only prefill the existing form.
export function inviteCode(raw) {
  try {
    // Older supported Android WebViews parse custom schemes as opaque paths.
    // Match our one explicit route, then use the standard query parser only.
    const route = typeof raw === 'string' && /^br\.app\.tamoon:\/\/invite\/?\?([^#\s\\]*)$/.exec(raw);
    if (!route || route[0] !== raw) return null;
    const params = new URLSearchParams(route[1]);
    if (params.getAll('code').length !== 1) return null;
    const code = params.get('code').trim().toUpperCase();
    return /^[A-F0-9]{8}$/.test(code) ? code : null;
  } catch { return null; }
}

export function createInviteReceiver({storage, session, getApp, location}) {
  let receivedEvent = false;
  return (raw, {launch = false} = {}) => {
    const code = inviteCode(raw);
    if (!code) return false;
    // getLaunchUrl is the original launch URL even after navigating to Marketplace
    // and back. Consume it once per WebView session, while allowing new tap events.
    if (launch && (receivedEvent || session.getItem('tamoon-consumed-launch-invite') === raw)) return false;
    if (!launch) receivedEvent = true;
    session.setItem('tamoon-consumed-launch-invite', raw);
    storage.setItem('tamoon-pending-invite', code);
    if (location.pathname.startsWith('/marketplace/')) {
      location.assign(`${location.protocol}//${location.host}/`);
      return true;
    }
    const app = getApp();
    if (app) {
      app.pendingInvite = code;
      if (app.ready && app.state?.profile?.id && !app.legalGateVisible) app.openJoinGroupModal(code);
    }
    return true;
  };
}
