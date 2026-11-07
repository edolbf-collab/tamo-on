// Native notifications: explicit consent, account-bound registration and safe destinations.
export function nativeNotificationURL(value, origin = 'capacitor://localhost') {
  try {
    const url = new URL(value, 'https://app.tamoon.app.br');
    if (!['https://app.tamoon.app.br', origin].includes(url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin)) return null;
    if (!['/', '/index.html'].includes(url.pathname)) return null;
    return `${origin}/${url.search}`;
  } catch { return null; }
}

export function createNativePush({plugin, storage, environment, getApp, uuid = () => crypto.randomUUID()}) {
  let client, userId, endpoint = '', installing, registration, desired = false, generation = 0;
  let pendingURL = '';
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
        if (!pending || !desired || pending.generation !== generation) return;
        try {
          const token = String(value || '').toLowerCase();
          if (!/^[a-f0-9]{64,512}$/.test(token)) throw Error('A Apple retornou um registro de aparelho inválido.');
          const {data} = await client.auth.getSession();
          if (data.session?.user?.id !== userId || pending.generation !== generation) throw Error('A conta mudou. Ative as notificações novamente.');
          await rpc('save_native_push_subscription', {p_token: token, p_environment: environment, p_installation_id: installationId});
          if (pending.generation !== generation) return;
          endpoint = `apns://${environment}/${token}`;
          await storage.setItem(preference, 'yes');
          pending.resolve(endpoint);
        } catch (error) { pending.reject(error); }
      });
      await plugin.addListener('registrationError', () => registration?.reject(Error('Não foi possível registrar este iPhone na Apple. Tente novamente.')));
      await plugin.addListener('pushNotificationReceived', () => {
        const app = getApp();
        if (app?.ready && app.state.profile?.id === userId) app.repo.loadUserNotifications().then(() => app.updateNotificationBadge()).catch(() => {});
      });
      await plugin.addListener('pushNotificationActionPerformed', ({notification}) => {
        pendingURL = nativeNotificationURL(notification?.data?.url) || '';
        flush();
      });
    })();
    return installing;
  };
  function flush() {
    const app = getApp();
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
    const timeout = setTimeout(() => current.reject(Error('A Apple não confirmou o registro. Verifique a conexão e tente novamente.')), 20000);
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
      registration?.reject(Error('Registro reiniciado.'));
      await listeners();
      installationId = await storage.getItem(installationKey);
      if (!installationId) { installationId = uuid(); await storage.setItem(installationKey, installationId); }
      desired = await storage.getItem(preference) === 'yes';
      if (desired && (await plugin.checkPermissions()).receive === 'granted') await register();
      flush();
    },
    async enable() {
      if (!client || !userId) throw Error('Entre na sua conta antes de ativar as notificações.');
      const permission = await plugin.requestPermissions();
      if (permission.receive !== 'granted') throw Error('Permita as notificações em Ajustes → Apps → Tâmo On → Notificações.');
      desired = true;
      return register();
    },
    async disable() {
      if (!client || !installationId) return;
      generation += 1; desired = false;
      // Stop on the server before confirming sign-out or disabling on this device.
      await rpc('remove_native_push_subscription', {p_installation_id: installationId});
      endpoint = ''; pendingURL = '';
      registration?.reject(Error('Notificações desativadas.'));
      await storage.setItem(preference, 'no');
      await plugin.unregister();
      await plugin.removeAllDeliveredNotifications().catch(() => {});
    },
    async status() {
      const permission = (await plugin.checkPermissions()).receive;
      let active = false;
      if (client && installationId && userId) {
        const {data, error} = await client.from('native_push_subscriptions').select('enabled').eq('installation_id', installationId).eq('user_id', userId).maybeSingle();
        if (error) throw error;
        active = permission === 'granted' && desired && Boolean(data?.enabled) && Boolean(endpoint);
      }
      return {permission, active, endpoint};
    },
    async test() {
      if (!endpoint) throw Error('Ative as notificações neste iPhone primeiro.');
      const {data, error} = await client.functions.invoke('publish-announcement', {body: {action:'test-push', endpoint, groupId:getApp()?.state.currentGroupId}});
      if (error || !data?.sent) throw Error(data?.failureReason || 'Não foi possível enviar o teste ao serviço da Apple.');
      return data;
    }
  };
}
