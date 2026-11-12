// Serialize OS updates so an older read cannot restore a badge after sign-out.
export function createNativeBadge({plugin, setCount, getApp}) {
  let work = Promise.resolve();
  let generation = 0;
  let active = true;
  const enqueue = task => {
    work = work.catch(() => {}).then(task);
    return work;
  };
  return {
    activate() { active = true; },
    sync(count) {
      const app = getApp();
      const userId = app?.state?.profile?.id;
      if (!active || !app?.ready || !userId || !Number.isInteger(count) || count < 0 || count > 200) return Promise.resolve();
      const version = generation;
      const readIds = new Set((app.state.user_notifications || []).filter(item => item.read_at).map(item => item.id));
      const current = () => version === generation && getApp()?.state?.profile?.id === userId;
      return enqueue(async () => {
        if (!current()) return;
        if (setCount) await setCount(count).catch(() => {});
        // Android dots follow active notifications. Remove only known read IDs,
        // preserving newer arrivals, tests and notifications outside this snapshot.
        if (!current() || !readIds.size) return;
        const {notifications} = await plugin.getDeliveredNotifications();
        if (!current()) return;
        const read = (notifications || []).filter(notification => {
          // FCM custom data lives in the tap intent, not necessarily in the tray
          // extras returned by Capacitor. The server's stable tag identifies it.
          if (typeof notification.tag === 'string' && notification.tag.startsWith('tamoon-inbox:'))
            return readIds.has(notification.tag.slice('tamoon-inbox:'.length));
          try {
            const url = new URL(notification.data?.url || '', 'https://app.tamoon.app.br');
            return url.origin === 'https://app.tamoon.app.br' && readIds.has(url.searchParams.get('notification'));
          } catch { return false; }
        });
        if (read.length) await plugin.removeDeliveredNotifications({notifications:read});
      });
    },
    clear() {
      active = false;
      generation += 1;
      return enqueue(async () => {
        if (setCount) await setCount(0).catch(() => {});
        await plugin.removeAllDeliveredNotifications();
      });
    }
  };
}

export async function refreshNativeInbox(getApp) {
  const app = getApp();
  const userId = app?.state?.profile?.id;
  if (!app?.ready || !userId) return;
  await app.repo.loadUserNotifications();
  if (getApp() === app && app.state.profile?.id === userId) app.updateNotificationBadge();
}
