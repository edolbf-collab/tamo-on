// Invitations never authenticate or join a group. They only prefill the existing form.
export function inviteCode(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'br.app.tamoon:' || url.host !== 'invite' ||
        (url.pathname !== '' && url.pathname !== '/') || url.username || url.password || url.hash) return null;
    if (url.searchParams.getAll('code').length !== 1) return null;
    const code = url.searchParams.get('code').trim().toUpperCase();
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
