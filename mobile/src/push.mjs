// Native notifications: explicit consent, account-bound registration and safe destinations.
export function nativeNotificationURL(value, origin = 'capacitor://localhost') {
  try {
    const url = new URL(value, 'https://app.tamoon.app.br');
    if (!['https://app.tamoon.app.br', origin].includes(url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin)) return null;
    if (!['/', '/index.html'].includes(url.pathname)) return null;
    return `${origin}/${url.search}`;
  } catch { return null; }
}

export function createNativePush({plugin, storage, clearBadge, activateBadge, environment = 'production', platform = 'ios', origin = 'capacitor://localhost', notificationStatus, navigate, getApp, uuid = () => crypto.randomUUID()}) {
  const android = platform === 'android';
  const table = android ? 'android_push_subscriptions' : 'native_push_subscriptions';
  const saveRPC = android ? 'save_android_push_subscription' : 'save_native_push_subscription';
  const removeRPC = android ? 'remove_android_push_subscription' : 'remove_native_push_subscription';
  let client, userId, endpoint = '', installing, registration, desired = false, generation = 0;
  let pendingURL = '';
  async function permission() {
    const value=(await plugin.checkPermissions())?.receive;
    // A missing bridge response is not permission granted (or user denial).
    if (!['granted','denied','prompt','prompt-with-rationale'].includes(value)) return 'unavailable';
    if(android&&value==='granted'&&notificationStatus&&!(await notificationStatus()).enabled)return 'denied';
    return value;
  }
  const preference = 'tamoon-native-push-enabled';
  const installationKey = 'tamoon-native-push-installation';
  let installationId;
  let databaseWork = Promise.resolve();
  const rpc = (name, args) => {
    const currentClient = client;
    const task = databaseWork.catch(() => {}).then(async () => {
      const result = await currentClient.rpc(name, args);
      if (result.error) throw result.error;
      return result.data;
    });
    databaseWork = task;
    return task;
  };
  const listeners = async () => {
    if (installing) return installing;
    installing = (async () => {
      await plugin.addListener('registration', async ({value}) => {
        const pending = registration;
        const eventGeneration = generation;
        if (!desired || !client || !installationId || (pending && pending.generation !== generation)) return;
        try {
          const token = android ? String(value || '') : String(value || '').toLowerCase();
          if (!(android ? /^[A-Za-z0-9_:-]{20,2048}$/ : /^[a-f0-9]{64,512}$/).test(token)) throw Error('O serviço retornou um registro de aparelho inválido.');
          const {data} = await client.auth.getSession();
          if (data.session?.user?.id !== userId || eventGeneration !== generation) throw Error('A conta mudou. Ative as notificações novamente.');
          await rpc(saveRPC, {p_token: token, ...(android ? {} : {p_environment: environment}), p_installation_id: installationId});
          if (eventGeneration !== generation) return;
          endpoint = android ? `fcm://${token}` : `apns://${environment}/${token}`;
          await storage.setItem(preference, 'yes');
          pending?.resolve(endpoint);
        } catch (error) { endpoint = ''; pending?.reject(error); }
      });
      await plugin.addListener('registrationError', () => registration?.reject(Error('Não foi possível registrar este aparelho. Tente novamente.')));
      await plugin.addListener('pushNotificationReceived', () => {
        const app = getApp();
        if (app?.ready && app.state.profile?.id === userId) app.repo.loadUserNotifications().then(() => app.updateNotificationBadge()).catch(() => {});
      });
      await plugin.addListener('pushNotificationActionPerformed', ({notification}) => {
        pendingURL = nativeNotificationURL(notification?.data?.url, origin) || '';
        flush();
      });
    })();
    return installing;
  };
  function flush() {
    const app = getApp();
    if(pendingURL && !app && navigate?.(pendingURL)){pendingURL='';return;}
    if (!pendingURL || !app?.ready || app.state.profile?.id !== userId) return;
    app.pendingNotificationUrl = pendingURL;
    pendingURL = '';
    app.drainNotificationOpen().catch(() => app.toast('Não foi possível abrir o aviso.', true));
  }
  async function register() {
    if (registration) return registration.promise;
    const current = {generation};
    current.promise = new Promise((resolve, reject) => { current.resolve = resolve; current.reject = reject; });
    registration = current;
    const timeout = setTimeout(() => current.reject(Error('O serviço não confirmou o registro. Verifique a conexão e tente novamente.')), 20000);
    try {
      return await Promise.all([current.promise, plugin.register()]).then(([value]) => value);
    } finally {
      clearTimeout(timeout);
      if (registration === current) registration = null;
    }
  }
  return {
    listen: listeners,
    flush,
    async initialize(authClient, accountId) {
      client = authClient; userId = accountId; generation += 1;
      activateBadge?.();
      registration?.reject(Error('Registro reiniciado.'));
      await listeners();
      installationId = await storage.getItem(installationKey);
      if (!installationId) { installationId = uuid(); await storage.setItem(installationKey, installationId); }
      desired = await storage.getItem(preference) === 'yes';
      if (desired && (await permission()) === 'granted') await register();
      flush();
    },
    async enable() {
      if (!client || !userId) throw Error('Entre na sua conta antes de ativar as notificações.');
      const requested = await plugin.requestPermissions();
      const checked = await permission();
      if (!requested?.receive || checked === 'unavailable') throw Error('Não foi possível consultar a permissão de notificações neste aparelho. Atualize o aplicativo e tente novamente.');
      if (requested.receive !== 'granted' || checked !== 'granted') throw Error('Permita as notificações em Ajustes → Apps → Tâmo On → Notificações.');
      if (android) await plugin.createChannel({id:'tamoon-alerts',name:'Avisos do Tâmo On',importance:4,sound:'default',visibility:0});
      desired = true;
      activateBadge?.();
      return register();
    },
    async disable() {
      if (!client || !installationId) return;
      generation += 1; desired = false;
      // Stop on the server before confirming sign-out or disabling on this device.
      await rpc(removeRPC, {p_installation_id: installationId});
      endpoint = ''; pendingURL = '';
      registration?.reject(Error('Notificações desativadas.'));
      await storage.setItem(preference, 'no');
      try { await plugin.unregister(); }
      finally { await (clearBadge ? clearBadge() : plugin.removeAllDeliveredNotifications()).catch(() => {}); }
    },
    async status() {
      const permissionValue = await permission();
      let active = false;
      if (client && installationId && userId) {
        const {data, error} = await client.from(table).select('enabled').eq('installation_id', installationId).eq('user_id', userId).maybeSingle();
        if (error) throw error;
        active = permissionValue === 'granted' && desired && Boolean(data?.enabled) && Boolean(endpoint);
      }
      return {permission:permissionValue, active, endpoint, provider:android?'Google':'Apple'};
    },
    async test() {
      if (!endpoint) throw Error('Ative as notificações neste aparelho primeiro.');
      const {data, error} = await client.functions.invoke('publish-announcement', {body: {action:'test-push', endpoint, groupId:getApp()?.state.currentGroupId}});
      if (error || !data?.sent) throw Error(data?.failureReason || 'Não foi possível enviar o teste ao serviço de notificações.');
      return data;
    }
  };
}
