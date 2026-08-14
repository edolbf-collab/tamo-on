(() => {
  "use strict";

  const APP_RELEASE = Object.freeze({ channel: "beta", version: "Beta 1.0", build: 144, database: 141, edge: 111 });
  const APP_ASSET_TOKEN = "beta144r1";
  const createEmptyState = () => ({
    profile: null,
    groups: [],
    currentGroupId: null,
    members: [],
    players: [],
    matches: [],
    attendance: [],
    assignments: [],
    charges: [],
    payments: [],
    expenses: [],
    member_ratings: [],
    match_events: [],
    announcements: [],
    push_subscriptions: [],
    is_platform_admin: false,
    beta_access: null
  });
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = () => crypto.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
  const nowIso = () => new Date().toISOString();
  const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
  const shortDate = iso => new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
  const safeImageUrl = (value = "") => {
    try {
      const url = new URL(value, window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };
  const extractUserAvatar = (user = null) => {
    const candidates = [];
    const meta = user?.user_metadata || {};
    candidates.push(meta.avatar_url, meta.picture, meta.photo_url, meta.picture_url);
    const identities = Array.isArray(user?.identities) ? user.identities : [];
    identities.forEach(identity => {
      const data = identity?.identity_data || {};
      candidates.push(data.avatar_url, data.picture, data.photo_url, data.picture_url);
    });
    const chosen = candidates.map(value => safeImageUrl(value || "")).find(Boolean);
    return chosen || "";
  };

  const resolvePublicConfig = () => {
    if (window.TAMOON_CONFIG && typeof window.TAMOON_CONFIG === "object") return window.TAMOON_CONFIG;
    for (const key of Object.keys(window)) {
      try {
        const value = window[key];
        if (value && typeof value === "object" && typeof value.supabaseUrl === "string" && (typeof value.supabasePublishableKey === "string" || typeof value.supabaseAnonKey === "string")) {
          window.TAMOON_CONFIG = value;
          return value;
        }
      } catch {}
    }
    return {};
  };
  const migrateClientKeys = () => {
    const move = (storage, suffix, target) => {
      try {
        if (storage.getItem(target)) return;
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key && key !== target && key.endsWith(suffix)) {
            const value = storage.getItem(key);
            if (value != null) storage.setItem(target, value);
            storage.removeItem(key);
            break;
          }
        }
      } catch {}
    };
    move(localStorage, "-current-group", "tamoon-current-group");
    move(localStorage, "-pending-invite", "tamoon-pending-invite");
  };
  const appBaseUrl = () => new URL("./", document.baseURI).href;
  const assetUrl = path => new URL(path, document.baseURI).href;
  const avatarKey = value => /^badge-(0[1-9]|1[0-9]|20)$/.test(String(value || "")) ? String(value) : "badge-01";
  const groupAvatarUrl = key => {
    const normalized = avatarKey(key);
    return window.TAMOON_GROUP_AVATARS?.[normalized] || assetUrl(`assets/group-avatars-build-142/${normalized}.png?v=beta144r1`);
  };
  const positionOptions = ["Goleiro", "Zagueiro", "Lateral", "Volante", "Meia", "Atacante", "Coringa"];
  const isPrimaryGoalkeeper = player => String(player?.primary_position || "") === "Goleiro";
  const canPlayGoalkeeper = player => Boolean(player && (isPrimaryGoalkeeper(player) || player.goalkeeper));
  const goalkeeperGloveIcon = (player, options = {}) => {
    if (!canPlayGoalkeeper(player)) return "";
    const designated = Boolean(options.designated);
    const label = designated
      ? "Goleiro definido para este time"
      : isPrimaryGoalkeeper(player)
        ? "Goleiro principal"
        : "Também pode jogar no gol";
    const classes = ["goalkeeper-glove-icon", isPrimaryGoalkeeper(player) ? "is-primary" : "is-alternate", designated ? "is-designated" : ""].filter(Boolean).join(" ");
    return `<span class="${classes}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 10V5.8a1.5 1.5 0 0 1 3 0V10 4.3a1.5 1.5 0 0 1 3 0V10 5.1a1.5 1.5 0 0 1 3 0V11 7.2a1.5 1.5 0 0 1 3 0v7.1c0 4.3-2.7 7-6.7 7H11c-2.7 0-4.8-1.2-6.2-3.5l-2.1-3.4a1.8 1.8 0 0 1 2.8-2.2L7 13.5V10Z"/><path d="M8.2 21.2h7.6"/></svg></span>`;
  };
  const playerPositionHtml = (player, options = {}) => `<span class="player-position-inline"><span>${escapeHtml(player?.primary_position || "Sem posição")}</span>${goalkeeperGloveIcon(player, options)}</span>`;
  const roleLabels = { owner: "Administrador", admin: "Administrador", organizer: "Organizador", treasurer: "Tesoureiro", member: "Membro" };
  const roleClass = role => `role-${role || "member"}`;
  const oauthErrorFromLocation = () => {
    const sources = [new URLSearchParams(location.search), new URLSearchParams(location.hash.replace(/^#/, ""))];
    for (const params of sources) {
      const message = params.get("error_description") || params.get("error");
      if (message) return String(message).replace(/\+/g, " ");
    }
    return "";
  };
  const loadScriptOnce = (id, src) => new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (id === "google-identity-script" && window.google?.accounts?.id) return resolve();
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Não foi possível carregar o serviço de login do Google."));
    document.head.appendChild(script);
  });
  const randomNonce = () => {
    const values = new Uint8Array(24);
    crypto.getRandomValues(values);
    return [...values].map(value => value.toString(16).padStart(2, "0")).join("");
  };
  const sha256Hex = async value => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  };
  const base64UrlToUint8Array = value => {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
  };
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const deviceLabel = () => isIos() ? "iPhone/iPad" : /android/i.test(navigator.userAgent) ? "Android" : "Navegador";
  const pushFailureSummary = (statusCode = 0, reason = "", label = "") => {
    const text = String(reason || "").toLowerCase();
    const provider = /iphone|ipad/i.test(label) || text.includes("web.push.apple.com") ? "Apple Web Push" : /android/i.test(label) ? "Google Push" : "serviço de push";
    if ([404, 410].includes(Number(statusCode))) return "A assinatura expirou ou deixou de ser reconhecida. Vincule as notificações novamente.";
    if ([401, 403].includes(Number(statusCode))) return "Houve uma falha de autenticação da plataforma com o serviço de push.";
    if (Number(statusCode) === 400) return "A mensagem foi rejeitada pelo serviço de push.";
    if (Number(statusCode) === 408 || text.includes("timeout") || text.includes("timed out")) return `O tempo limite de conexão com ${provider} foi excedido.`;
    if (Number(statusCode) === 429) return `O ${provider} aplicou um limite temporário de solicitações.`;
    if (Number(statusCode) >= 500) return `O ${provider} ficou temporariamente indisponível.`;
    if (!Number(statusCode) || text.includes("error sending request") || text.includes("connection") || text.includes("network")) return `Houve uma falha temporária de conexão com ${provider}.`;
    return Number(statusCode) ? `Falha no serviço de push. Código ${Number(statusCode)}.` : "Falha não identificada no serviço de push.";
  };

  class SupabaseRepository {
    constructor(config) {
      this.config = config;
      this.client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      this.state = createEmptyState();
      this.channel = null;
      this.subscribedGroupId = null;
      this.reloadTimer = null;
    }

    async session() {
      return (await this.client.auth.getSession()).data.session;
    }

    async claimBetaAccess() {
      const { data, error } = await this.client.rpc("claim_beta_access");
      if (error) {
        const denied = new Error(error.message || "Acesso ao beta não autorizado.");
        denied.betaAccessDenied = true;
        throw denied;
      }
      this.state.beta_access = data || null;
      return data;
    }

    async signInWithGoogleIdToken(token, nonce) {
      return this.client.auth.signInWithIdToken({ provider: "google", token, nonce });
    }

    async signInWithGoogleOAuth() {
      const configuredRedirect = String(this.config.authRedirectUrl || "").trim();
      const redirectTo = configuredRedirect || appBaseUrl();
      return this.client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: { prompt: "select_account" }
        }
      });
    }

    async signOut() {
      clearTimeout(this.reloadTimer);
      if (this.channel) {
        await this.client.removeChannel(this.channel);
        this.channel = null;
        this.subscribedGroupId = null;
      }
      const { error } = await this.client.auth.signOut({ scope: "local" });
      if (error) throw error;
    }

    async init(preferredGroupId = null) {
      const session = await this.session();
      if (!session) return null;
      const user = session.user;
      const meta = user.user_metadata || {};
      const email = user.email || "";
      const name = meta.name || meta.full_name || [meta.given_name, meta.family_name].filter(Boolean).join(" ") || email.split("@")[0] || "Usuário";
      const avatarUrl = extractUserAvatar(user);
      this.state.profile = { id: user.id, email, name, avatar_url: avatarUrl };
      await this.claimBetaAccess();

      const { data: memberships, error } = await this.client
        .from("group_members")
        .select("role,player_id,groups(id,name,invite_code,avatar_key,created_by,created_at,default_players_per_team,monthly_fee)")
        .eq("user_id", user.id);
      if (error) throw error;

      this.state.groups = (memberships || []).filter(item => item.groups).map(item => ({ ...item.groups, role: item.role, player_id: item.player_id }));
      const preferred = this.state.groups.find(group => group.id === preferredGroupId)?.id;
      this.state.currentGroupId = preferred || this.state.groups[0]?.id || null;
      if (this.state.currentGroupId) {
        await this.loadGroup(this.state.currentGroupId);
      } else {
        ["members", "players", "matches", "attendance", "assignments", "charges", "payments", "expenses", "member_ratings", "match_events", "announcements", "push_subscriptions"].forEach(key => { this.state[key] = []; });
      }
      try {
        const { data } = await this.client.rpc("is_platform_admin");
        this.state.is_platform_admin = data === true;
      } catch (error) {
        console.warn("Não foi possível verificar a administração da plataforma.", error);
      }
      return this.state;
    }

    async loadGroup(groupId, options = {}) {
      const { subscribe = true } = options;
      this.state.currentGroupId = groupId;
      const tableNames = ["players", "matches", "charges", "payments", "expenses", "announcements", "group_members", "member_ratings"];
      const results = await Promise.all(tableNames.map(table => this.client.from(table).select("*").eq("group_id", groupId)));
      results.forEach((result, index) => {
        if (result.error) throw result.error;
        const stateKey = tableNames[index] === "group_members" ? "members" : tableNames[index];
        this.state[stateKey] = result.data || [];
      });

      const subscriptions = await this.client.from("push_subscriptions").select("id,endpoint,device_label,enabled,created_at,updated_at,last_attempt_at,last_success_at,last_failure_at,last_failure_status,last_failure_reason,consecutive_failures,invalidated_at,last_test_at,last_recovered_at,last_delivery_attempts,last_error_category,last_provider").eq("user_id", this.state.profile.id);
      if (subscriptions.error) throw subscriptions.error;
      this.state.push_subscriptions = subscriptions.data || [];

      const [attendance, assignments, events] = await Promise.all([
        this.client.from("match_attendance").select("*").eq("group_id", groupId),
        this.client.from("team_assignments").select("*").eq("group_id", groupId),
        this.client.from("match_events").select("*").eq("group_id", groupId)
      ]);
      [["attendance", attendance], ["assignments", assignments], ["match_events", events]].forEach(([key, result]) => {
        if (result.error) throw result.error;
        this.state[key] = result.data || [];
      });

      const ownAvatar = safeImageUrl(this.state.profile?.avatar_url || "");
      if (ownAvatar) {
        this.state.players = (this.state.players || []).map(player => player?.user_id === this.state.profile?.id && !safeImageUrl(player.avatar_url || "")
          ? { ...player, avatar_url: ownAvatar }
          : player);
      }

      if (subscribe) this.subscribe(groupId);
      return this.state;
    }

    queueReload(groupId) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(async () => {
        if (this.state.currentGroupId !== groupId) return;
        try {
          await this.loadGroup(groupId, { subscribe: false });
          App.state = this.state;
          App.render();
        } catch (error) {
          console.error("Falha ao sincronizar alteração em tempo real.", error);
        }
      }, 180);
    }

    subscribe(groupId) {
      if (this.channel && this.subscribedGroupId === groupId) return;
      if (this.channel) this.client.removeChannel(this.channel);
      const onChange = () => this.queueReload(groupId);
      let channel = this.client.channel(`group-${groupId}`);
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `id=eq.${groupId}` }, onChange);
      ["group_members", "players", "matches", "match_attendance", "team_assignments", "member_ratings", "match_events", "charges", "payments", "expenses", "announcements"].forEach(table => {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `group_id=eq.${groupId}` }, onChange);
      });
      this.channel = channel.subscribe();
      this.subscribedGroupId = groupId;
    }

    async mutate(collection, record, mode = "upsert") {
      const tableMap = { attendance: "match_attendance", assignments: "team_assignments" };
      const table = tableMap[collection] || collection;
      if (mode === "delete") {
        const { error } = await this.client.from(table).delete().eq("id", record.id);
        if (error) throw error;
      } else {
        const { error } = await this.client.from(table).upsert(record);
        if (error) throw error;
      }
      return this.loadGroup(this.state.currentGroupId, { subscribe: false });
    }

    async setProfile(name) {
      const { data, error } = await this.client.rpc("update_my_profile", { p_name: String(name || "").trim() });
      if (error) throw error;
      const userUpdate = await this.client.auth.updateUser({ data: { name: data || name } });
      if (userUpdate.error) console.warn(userUpdate.error);
      this.state.profile = { ...this.state.profile, name: data || name };
      return this.state.profile;
    }

    async updateMyPlayer(groupId, payload) {
      const { error } = await this.client.rpc("update_my_player_profile", {
        p_group_id: groupId,
        p_nickname: payload.nickname || "",
        p_primary_position: payload.primaryPosition,
        p_secondary_position: payload.secondaryPosition || "",
        p_goalkeeper: Boolean(payload.goalkeeper)
      });
      if (error) throw error;
      return this.loadGroup(groupId, { subscribe: false });
    }

    async createGroup(name, avatar) {
      const { data, error } = await this.client.rpc("create_group", { p_name: name, p_avatar_key: avatarKey(avatar) });
      if (error) throw error;
      await this.init(data);
      return data;
    }

    async joinGroup(code) {
      const { data, error } = await this.client.rpc("join_group_by_code", { p_code: String(code || "").toUpperCase() });
      if (error) throw error;
      await this.init(data);
      return data;
    }

    async updateGroup(groupId, name, avatar) {
      const { error } = await this.client.rpc("update_group_settings", { p_group_id: groupId, p_name: name, p_avatar_key: avatarKey(avatar) });
      if (error) throw error;
      await this.init(groupId);
    }

    async deleteGroup(groupId, confirmation) {
      clearTimeout(this.reloadTimer);
      const { error } = await this.client.rpc("delete_group_permanently", {
        p_group_id: groupId,
        p_confirmation: confirmation
      });
      if (error) throw error;
      if (this.channel) {
        await this.client.removeChannel(this.channel);
        this.channel = null;
        this.subscribedGroupId = null;
      }
      await this.init(null);
      return this.state;
    }

    async createMatchSchedule(payload) {
      const { data, error } = await this.client.rpc("create_match_schedule", {
        p_group_id: payload.groupId,
        p_title: payload.title,
        p_starts_at: payload.startsAt,
        p_location: payload.location,
        p_max_players: payload.maxPlayers,
        p_players_per_team: payload.playersPerTeam,
        p_bbq_enabled: payload.bbqEnabled,
        p_bbq_price: payload.bbqPrice,
        p_notes: payload.notes || "",
        p_occurrences: payload.occurrences || 1
      });
      if (error) throw error;
      await this.loadGroup(payload.groupId, { subscribe: false });
      return data || [];
    }

    async setMemberRole(groupId, userId, role) {
      const { error } = await this.client.rpc("set_member_role", { p_group_id: groupId, p_user_id: userId, p_role: role });
      if (error) throw error;
      return this.loadGroup(groupId, { subscribe: false });
    }

    async transferAdministration(groupId, userId) {
      const { error } = await this.client.rpc("transfer_group_administration", { p_group_id: groupId, p_new_admin_user_id: userId });
      if (error) throw error;
      await this.init(groupId);
    }

    async removeGroupMember(groupId, userId) {
      const { error } = await this.client.rpc("remove_group_member", {
        p_group_id: groupId,
        p_user_id: userId
      });
      if (error) throw error;
      return this.loadGroup(groupId, { subscribe: false });
    }

    async updateMatchBbq(matchId, enabled, price) {
      const { error } = await this.client.rpc("update_match_bbq_settings", {
        p_match_id: matchId,
        p_enabled: Boolean(enabled),
        p_price: Number(price || 0)
      });
      if (error) throw error;
      return this.loadGroup(this.state.currentGroupId, { subscribe: false });
    }

    async setMyAttendance(matchId, payload) {
      const { data, error } = await this.client.rpc("set_my_match_attendance", {
        p_match_id: matchId,
        p_status: payload.status,
        p_bbq: Boolean(payload.bbq),
        p_bbq_guests: Number(payload.bbqGuests || 0),
        p_bbq_note: payload.bbqNote || ""
      });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data || {};
    }

    async setMyGameResponse(matchId, status) {
      const { data, error } = await this.client.rpc("set_my_match_game_response", {
        p_match_id: matchId,
        p_status: status
      });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data || {};
    }

    async setMyBbqResponse(matchId, attending) {
      const { data, error } = await this.client.rpc("set_my_match_bbq_response", {
        p_match_id: matchId,
        p_bbq: Boolean(attending)
      });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data || {};
    }

    async manageAttendances(matchId, changes) {
      const { data, error } = await this.client.rpc("manage_match_attendance_batch", {
        p_match_id: matchId,
        p_changes: changes.map(change => ({ player_id: change.playerId, status: change.status }))
      });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data || {};
    }

    async drawMatchWaitlist(matchId, playerIds, waitlistCount) {
      const { data, error } = await this.client.rpc("draw_match_waitlist_v2", {
        p_match_id: matchId,
        p_player_ids: playerIds,
        p_waitlist_count: Number(waitlistCount)
      });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data || {};
    }

    async clearMatchWaitlistDraw(matchId) {
      const { data, error } = await this.client.rpc("clear_match_waitlist_draw", { p_match_id: matchId });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data || {};
    }

    async updateMatchSettings(matchId, payload) {
      const { data, error } = await this.client.rpc("update_match_settings", {
        p_match_id: matchId,
        p_max_players: Number(payload.maxPlayers),
        p_players_per_team: payload.playersPerTeam == null ? null : Number(payload.playersPerTeam),
        p_notes: payload.notes || ""
      });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data || {};
    }

    async createMatchGuest(payload) {
      const { data, error } = await this.client.rpc("create_match_guest", {
        p_match_id: payload.matchId,
        p_name: payload.name,
        p_nickname: payload.nickname || "",
        p_primary_position: payload.position,
        p_goalkeeper: Boolean(payload.goalkeeper)
      });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data;
    }

    async updateMatchGuest(payload) {
      const { data, error } = await this.client.rpc("update_match_guest", {
        p_player_id: payload.playerId,
        p_name: payload.name,
        p_nickname: payload.nickname || "",
        p_primary_position: payload.position,
        p_goalkeeper: Boolean(payload.goalkeeper)
      });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data;
    }

    async deleteMatchGuest(playerId) {
      const { data, error } = await this.client.rpc("delete_match_guest", { p_player_id: playerId });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data;
    }

    async rateMember(groupId, playerId, score) {
      const { error } = await this.client.rpc("upsert_member_rating", { p_group_id: groupId, p_rated_player_id: playerId, p_score: Number(score) });
      if (error) throw error;
    }

    async deleteMatch(matchId) {
      const { error } = await this.client.rpc("delete_scheduled_match", { p_match_id: matchId });
      if (error) throw error;
      return this.loadGroup(this.state.currentGroupId, { subscribe: false });
    }

    async deleteMatchSeries(matchId) {
      const { error } = await this.client.rpc("delete_scheduled_match_series", { p_match_id: matchId });
      if (error) throw error;
      return this.loadGroup(this.state.currentGroupId, { subscribe: false });
    }

    async balanceTeams(matchId, teamCount) {
      const { error } = await this.client.rpc("balance_match_teams_with_count", {
        p_match_id: matchId,
        p_team_count: Number(teamCount)
      });
      if (error) throw error;
      return this.loadGroup(this.state.currentGroupId, { subscribe: false });
    }

    async clearMatchTeams(matchId) {
      const { data, error } = await this.client.rpc("clear_match_team_assignments", {
        p_match_id: matchId
      });
      if (error) throw error;
      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return data || {};
    }

    async recordPayment(record, charge = null) {
      const { error } = await this.client.rpc("record_payment", {
        p_group_id: record.group_id,
        p_player_id: record.player_id,
        p_charge_id: charge?.id || null,
        p_description: record.description,
        p_amount: record.amount,
        p_method: record.method || "manual",
        p_paid_at: record.paid_at || new Date().toISOString()
      });
      if (error) throw error;
      return this.loadGroup(this.state.currentGroupId, { subscribe: false });
    }

    async recordBatchPayments(groupId, chargeIds, description, method, paidAt) {
      const { data, error } = await this.client.rpc("record_batch_payments", {
        p_group_id: groupId,
        p_charge_ids: chargeIds,
        p_description: description,
        p_method: method || "manual",
        p_paid_at: paidAt || new Date().toISOString()
      });
      if (error) throw error;
      await this.loadGroup(groupId, { subscribe: false });
      return data || {};
    }

    async savePushSubscription(subscription) {
      const json = subscription.toJSON();
      const endpoint = String(json.endpoint || "").trim();
      const { error } = await this.client.rpc("save_push_subscription", {
        p_endpoint: endpoint,
        p_p256dh: json.keys?.p256dh || "",
        p_auth: json.keys?.auth || "",
        p_device_label: deviceLabel(),
        p_user_agent: navigator.userAgent
      });
      if (error) throw error;

      const verification = await this.client
        .from("push_subscriptions")
        .select("id,endpoint,device_label,enabled,created_at,updated_at,last_attempt_at,last_success_at,last_failure_at,last_failure_status,last_failure_reason,consecutive_failures,invalidated_at,last_test_at,last_recovered_at,last_delivery_attempts,last_error_category,last_provider")
        .eq("user_id", this.state.profile.id)
        .eq("endpoint", endpoint)
        .eq("enabled", true)
        .maybeSingle();
      if (verification.error) throw verification.error;
      if (!verification.data) throw new Error("O aparelho autorizou notificações, mas a assinatura não foi vinculada ao seu usuário no banco.");

      await this.loadGroup(this.state.currentGroupId, { subscribe: false });
      return verification.data;
    }

    async removePushSubscription(endpoint) {
      if (!endpoint) return;
      const { error } = await this.client.rpc("remove_push_subscription", { p_endpoint: endpoint });
      if (error) throw error;
      this.state.push_subscriptions = this.state.push_subscriptions.filter(item => item.endpoint !== endpoint);
    }

    async invokeNotification(payload) {
      const { data, error } = await this.client.functions.invoke("publish-announcement", { body: payload });
      if (error) {
        let message = error?.message || "A Edge Function recusou o envio da notificação.";
        let details = null;
        try {
          const response = error?.context;
          if (response && typeof response.clone === "function") {
            details = await response.clone().json().catch(async () => {
              const text = await response.text().catch(() => "");
              return text ? { error: text } : null;
            });
          }
        } catch (parseError) {
          console.warn("Não foi possível ler o retorno da Edge Function:", parseError);
        }
        if (details?.error || details?.message) {
          message = details.error || details.message;
          if (details.stage) message += ` [etapa: ${details.stage}]`;
        }
        const wrapped = new Error(message);
        wrapped.cause = error;
        wrapped.details = details;
        throw wrapped;
      }
      if (data?.error) throw new Error(data.error);
      return data || {};
    }

    async publishSystemNotification(title, body) {
      return this.invokeNotification({ action: "system-publish", title, body });
    }

    async publishAnnouncement(groupId, title, body) {
      const data = await this.invokeNotification({ action: "publish", groupId, title, body });
      if (!data?.announcement) throw new Error("O aviso não foi criado.");
      await this.loadGroup(groupId, { subscribe: false });
      return data;
    }

    async resendAnnouncement(groupId, announcementId) {
      const data = await this.invokeNotification({ action: "resend", groupId, announcementId });
      await this.loadGroup(groupId, { subscribe: false });
      return data;
    }

    async deleteAnnouncement(announcementId) {
      const { error } = await this.client.rpc("delete_announcement", { p_announcement_id: announcementId });
      if (error) throw error;
      return this.loadGroup(this.state.currentGroupId, { subscribe: false });
    }

    async notifyMatchCreated(groupId, matchId) {
      return this.invokeNotification({
        action: "match-created",
        groupId,
        matchId,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo"
      });
    }

    async notifyAttendanceConfirmed(groupId, matchId, playerId) {
      return this.invokeNotification({
        action: "attendance-confirmed",
        groupId,
        matchId,
        playerId,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo"
      });
    }

    async notifyAttendanceDeclined(groupId, matchId, playerId) {
      return this.invokeNotification({
        action: "attendance-declined",
        groupId,
        matchId,
        playerId,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo"
      });
    }

    async notifyAttendanceReminder(groupId, matchId, playerId) {
      return this.invokeNotification({
        action: "attendance-reminder",
        groupId,
        matchId,
        playerId,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo"
      });
    }

    async notifyChargeCreated(groupId, chargeId) {
      return this.invokeNotification({
        action: "charge-created",
        groupId,
        chargeId,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo"
      });
    }

    async testPushNotification(groupId, endpoint) {
      return this.invokeNotification({
        action: "test-push",
        groupId,
        endpoint
      });
    }

    async createBatchCharges(groupId, playerIds, description, amount, dueDate) {
      const { data, error } = await this.client.rpc("create_batch_charges", {
        p_group_id: groupId,
        p_player_ids: playerIds,
        p_description: description,
        p_amount: Number(amount),
        p_due_date: dueDate
      });
      if (error) throw error;
      await this.loadGroup(groupId, { subscribe: false });
      return data || {};
    }

    async deleteFinanceEntry(groupId, entryType, entryId) {
      const { error } = await this.client.rpc("delete_finance_entry", {
        p_group_id: groupId,
        p_entry_type: entryType,
        p_entry_id: entryId
      });
      if (error) throw error;
      return this.loadGroup(groupId, { subscribe: false });
    }

    async logEvent(eventType, metadata = {}, severity = "info") {
      try {
        await this.client.rpc("log_app_event", {
          p_event_type: String(eventType || "event").slice(0, 80),
          p_group_id: this.state.currentGroupId || null,
          p_severity: severity,
          p_metadata: {
            ...metadata,
            build: APP_RELEASE.build,
            version: APP_RELEASE.version,
            route: window.App?.route || "",
            device: deviceLabel(),
            userAgent: navigator.userAgent.slice(0, 500)
          }
        });
      } catch (error) {
        console.warn("Falha ao registrar evento de diagnóstico.", error);
      }
    }

    async reportProblem(payload) {
      const { data, error } = await this.client.rpc("submit_beta_feedback", {
        p_group_id: this.state.currentGroupId || null,
        p_category: payload.category,
        p_title: payload.title,
        p_description: payload.description,
        p_contact_ok: payload.contactOk,
        p_context: {
          build: APP_RELEASE.build,
          version: APP_RELEASE.version,
          route: window.App?.route || "",
          device: deviceLabel(),
          standalone: isStandalone(),
          notificationPermission: pushSupported() ? Notification.permission : "unsupported",
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          userAgent: navigator.userAgent.slice(0, 500)
        }
      });
      if (error) throw error;
      return data;
    }

    async platformDashboard() {
      const [summary, reports, logs, errorGroups, accessList, security, pushStatus] = await Promise.all([
        this.client.rpc("platform_beta_summary"),
        this.client.rpc("platform_recent_feedback", { p_limit: 30 }),
        this.client.rpc("platform_recent_logs", { p_limit: 50 }),
        this.client.rpc("platform_error_groups", { p_hours: 24, p_limit: 40 }),
        this.client.rpc("platform_beta_access_list", { p_limit: 300 }),
        this.client.rpc("platform_security_summary"),
        this.client.rpc("platform_push_health_list_v2", { p_limit: 500 })
      ]);
      for (const result of [summary, reports, logs, errorGroups, accessList, security, pushStatus]) if (result.error) throw result.error;
      return {
        summary: summary.data || {},
        reports: reports.data || [],
        logs: logs.data || [],
        errorGroups: errorGroups.data || [],
        accessList: accessList.data || [],
        security: security.data || {},
        pushStatus: pushStatus.data || []
      };
    }

    async inviteBetaAccess(email, notes = "") {
      const { data, error } = await this.client.rpc("platform_beta_access_invite", { p_email: email, p_notes: notes });
      if (error) throw error;
      return data;
    }

    async setBetaAccessStatus(email, status) {
      const { data, error } = await this.client.rpc("platform_beta_access_set_status", { p_email: email, p_status: status });
      if (error) throw error;
      return data;
    }

    async deleteBetaUserPermanently(email) {
      const { data, error } = await this.client.functions.invoke("delete-beta-user", {
        body: { email: String(email || "").trim().toLowerCase() }
      });
      if (error) {
        let message = error?.message || "A Edge Function recusou a exclusão permanente.";
        let details = null;
        try {
          const response = error?.context;
          if (response && typeof response.clone === "function") {
            details = await response.clone().json().catch(async () => {
              const text = await response.text().catch(() => "");
              return text ? { error: text } : null;
            });
          }
        } catch (parseError) {
          console.warn("Não foi possível ler o retorno da exclusão permanente:", parseError);
        }
        if (details?.error || details?.detail || details?.message) {
          message = details.error || details.detail || details.message;
          if (details.stage) message += ` [etapa: ${details.stage}]`;
        }
        const wrapped = new Error(message);
        wrapped.cause = error;
        wrapped.details = details;
        throw wrapped;
      }
      if (data?.error) throw new Error(data.error);
      return data || {};
    }

    async platformErrorDetails(group, limit = 120) {
      const { data, error } = await this.client.rpc("platform_error_details", {
        p_event_type: group.event_type,
        p_message: group.message,
        p_source: group.source || "",
        p_line: group.line || "",
        p_build: group.build || "",
        p_limit: limit
      });
      if (error) throw error;
      return data || [];
    }

    async platformOperationalExport(days = 30, logLimit = 5000) {
      const { data, error } = await this.client.rpc("platform_operational_export", { p_days: days, p_log_limit: logLimit });
      if (error) throw error;
      return data || {};
    }

    async platformGroupExport(groupId) {
      const { data, error } = await this.client.rpc("platform_group_export", { p_group_id: groupId });
      if (error) throw error;
      return data || {};
    }

    async platformPushDeliveryAttempts(userId = null, days = 30, limit = 500) {
      const { data, error } = await this.client.rpc("platform_push_delivery_attempts_v2", {
        p_user_id: userId || null,
        p_days: days,
        p_limit: limit
      });
      if (error) throw error;
      return data || [];
    }

    async appRelease() {
      const { data, error } = await this.client.from("app_releases").select("*").eq("channel", "beta").eq("active", true).order("build", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    }

  }

  const App = {
    route: "home",
    repo: null,
    state: createEmptyState(),
    ready: false,
    bootStartedAt: 0,
    bootLoaderTimer: null,
    bootSlowTimer: null,
    pendingInvite: "",
    launchAction: "",
    launchGroupId: "",
    launchAnnouncementId: "",
    launchMatchId: "",
    selectedTeamMatchId: "",
    selectedTeamMatchHistoryMode: false,
    swRegistration: null,
    updateAvailable: null,
    lastSyncAt: null,
    accessCheckTimer: null,

    htmlBuild() {
      return Number(document.querySelector('meta[name="app-build"]')?.content || 0);
    },

    startBootFeedback() {
      this.bootStartedAt = performance.now();
      this.ready = false;
      $("#app")?.setAttribute("aria-busy", "true");
      clearTimeout(this.bootLoaderTimer);
      clearTimeout(this.bootSlowTimer);
      const loader = $("#bootLoader");
      if (!loader) return;
      loader.hidden = true;
      loader.classList.remove("is-visible", "is-slow");
      this.bootLoaderTimer = setTimeout(() => {
        if (this.ready) return;
        loader.hidden = false;
        requestAnimationFrame(() => loader.classList.add("is-visible"));
      }, 240);
      this.bootSlowTimer = setTimeout(() => {
        if (this.ready) return;
        loader.classList.add("is-slow");
        const text = $("[data-boot-message]", loader);
        if (text) text.textContent = navigator.onLine ? "Sincronizando seu grupo…" : "Aguardando conexão com a internet…";
      }, 4500);
    },

    finishBootFeedback() {
      this.ready = true;
      $("#app")?.setAttribute("aria-busy", "false");
      clearTimeout(this.bootLoaderTimer);
      clearTimeout(this.bootSlowTimer);
      const loader = $("#bootLoader");
      if (!loader) return;
      loader.classList.remove("is-visible", "is-slow");
      setTimeout(() => { loader.hidden = true; }, 170);
    },

    cancelBootFeedback() {
      this.ready = false;
      $("#app")?.setAttribute("aria-busy", "false");
      clearTimeout(this.bootLoaderTimer);
      clearTimeout(this.bootSlowTimer);
      const loader = $("#bootLoader");
      if (loader) {
        loader.classList.remove("is-visible", "is-slow");
        loader.hidden = true;
      }
    },

    ensureReady() {
      if (this.ready) return true;
      return false;
    },

    detectBuildMismatch() {
      const htmlBuild = this.htmlBuild();
      if (!htmlBuild || htmlBuild === APP_RELEASE.build) return false;
      const key = `tamoon-build-reload-${htmlBuild}-${APP_RELEASE.build}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        const url = new URL(location.href);
        url.searchParams.set("app_update", Date.now().toString());
        location.replace(url.href);
        return true;
      }
      this.updateAvailable = { build: Math.max(htmlBuild, APP_RELEASE.build), version: "Arquivos em atualização" };
      return false;
    },

    async init() {
      this.bindGlobal();
      migrateClientKeys();
      this.captureInviteIntent();
      this.startBootFeedback();
      if (this.detectBuildMismatch()) return;
      const config = resolvePublicConfig();
      if (!(config.supabaseUrl && config.supabasePublishableKey)) {
        this.cancelBootFeedback();
        return this.renderConfigurationError();
      }
      if (!window.supabase) {
        this.cancelBootFeedback();
        return this.renderBackendError(window.TAMOON_CLOUD_LOAD_ERROR || new Error("Não foi possível carregar o cliente Supabase."));
      }

      this.repo = new SupabaseRepository(config);
      try {
        const loadedState = await this.repo.init(this.launchGroupId || localStorage.getItem("tamoon-current-group") || null);
        if (!loadedState) {
          this.cancelBootFeedback();
          return this.renderAuth();
        }
        this.state = loadedState || createEmptyState();
        this.lastSyncAt = nowIso();
        this.finishBootFeedback();
        this.render();
        this.startAccessMonitor();
        await this.registerServiceWorker();
        this.repo.logEvent("app_open", {
          groups: Array.isArray(this.state?.groups) ? this.state.groups.length : 0,
          htmlBuild: this.htmlBuild(),
          jsBuild: APP_RELEASE.build,
          assetToken: APP_ASSET_TOKEN,
          swBuild: window.tamoonPwa?.getState?.().swBuild || null
        });
        this.checkForUpdates();
        navigator.clearAppBadge?.().catch?.(() => {});
        if (this.pendingInvite) setTimeout(() => this.openJoinGroupModal(this.pendingInvite), 80);
        else if (this.launchAction === "rsvp") setTimeout(() => this.openRsvp(this.nextMatch()?.id), 80);
        else if (this.launchAnnouncementId) setTimeout(() => this.openAnnouncementCenter(this.launchAnnouncementId), 120);
        else if (this.launchMatchId) setTimeout(() => this.openMatchDetails(this.launchMatchId), 120);
        setTimeout(() => this.maybeShowNotificationOnboarding(), 650);
      } catch (error) {
        this.cancelBootFeedback();
        console.error(error);
        if (error?.betaAccessDenied || /beta fechado|acesso ao beta|não está autorizado|acesso.*bloqueado/i.test(error?.message || "")) {
          return this.renderBetaAccessDenied(error);
        }
        this.renderBackendError(error);
      }
    },

    startAccessMonitor() {
      clearInterval(this.accessCheckTimer);
      this.accessCheckTimer = setInterval(() => this.verifyBetaAccess(), 120000);
    },

    async verifyBetaAccess() {
      if (!this.repo || !this.state?.profile || !navigator.onLine) return;
      try {
        await this.repo.claimBetaAccess();
      } catch (error) {
        if (error?.betaAccessDenied || /beta fechado|acesso ao beta|não está autorizado|acesso.*bloqueado/i.test(error?.message || "")) {
          clearInterval(this.accessCheckTimer);
          this.renderBetaAccessDenied(error);
          return;
        }
        console.warn("Não foi possível conferir o acesso ao beta.", error);
      }
    },

    captureInviteIntent() {
      const params = new URLSearchParams(location.search);
      const invite = String(params.get("invite") || "").trim().toUpperCase();
      if (invite) localStorage.setItem("tamoon-pending-invite", invite);
      this.pendingInvite = localStorage.getItem("tamoon-pending-invite") || "";
      const page = params.get("page");
      if (["home", "matches", "teams", "members", "finance", "more"].includes(page)) this.route = page;
      this.launchAction = params.get("action") || "";
      this.launchGroupId = String(params.get("group") || "").trim();
      this.launchAnnouncementId = String(params.get("announcement") || "").trim();
      this.launchMatchId = String(params.get("match") || "").trim();
    },

    bindGlobal() {
      document.addEventListener("click", event => {
        const nav = event.target.closest("[data-route]");
        const action = event.target.closest("[data-action]");
        const appControl = nav || action || event.target.closest("#groupButton, #groupAvatarButton, #notificationButton, #profileButton");
        if (appControl && !this.ensureReady()) {
          event.preventDefault();
          return;
        }
        if (nav) {
          const targetRoute = nav.dataset.route;
          if (targetRoute === "teams") {
            this.selectedTeamMatchId = "";
            this.selectedTeamMatchHistoryMode = false;
          }
          this.route = targetRoute;
          this.render();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        if (action) this.handleAction(action.dataset.action, action.dataset);
      });
      document.addEventListener("keydown", event => {
        if (!["Enter", " "].includes(event.key)) return;
        const action = event.target.closest('.match-card[data-action="open-match"]');
        if (!action) return;
        event.preventDefault();
        this.handleAction(action.dataset.action, action.dataset);
      });
      $("#groupButton")?.addEventListener("click", () => this.openGroupModal());
      $("#groupAvatarButton")?.addEventListener("click", () => {
        if (this.currentGroup() && this.canManageGroup()) this.openGroupSettings();
        else this.openGroupModal();
      });
      $("#notificationButton")?.addEventListener("click", () => this.openAnnouncementCenter());
      $("#profileButton")?.addEventListener("click", () => this.openProfileModal());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.verifyBetaAccess();
      });
      window.addEventListener("focus", () => this.verifyBetaAccess());
      window.addEventListener("error", event => {
        if (!this.repo || !event.error) return;
        this.repo.logEvent("frontend_error", {
          message: event.message,
          source: event.filename?.split("/").pop() || "",
          line: event.lineno || 0,
          column: event.colno || 0,
          route: this.route,
          ready: this.ready,
          hasState: Boolean(this.state),
          groupsLoaded: Array.isArray(this.state?.groups),
          groupCount: Array.isArray(this.state?.groups) ? this.state.groups.length : 0,
          htmlBuild: this.htmlBuild(),
          jsBuild: APP_RELEASE.build,
          assetToken: APP_ASSET_TOKEN,
          swBuild: window.tamoonPwa?.getState?.().swBuild || null
        }, "error");
      });
      window.addEventListener("unhandledrejection", event => {
        if (!this.repo) return;
        const reason = event.reason;
        this.repo.logEvent("unhandled_rejection", {
          message: reason?.message || String(reason || "Erro assíncrono"),
          route: this.route,
          ready: this.ready,
          htmlBuild: this.htmlBuild(),
          jsBuild: APP_RELEASE.build,
          assetToken: APP_ASSET_TOKEN,
          swBuild: window.tamoonPwa?.getState?.().swBuild || null
        }, "error");
      });
      document.addEventListener("error", event => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.matches("[data-group-avatar]")) return;
        if (image.dataset.fallbackApplied === "true") return;
        image.dataset.fallbackApplied = "true";
        image.src = window.TAMOON_GROUP_AVATARS?.["badge-01"] || assetUrl("assets/group-avatars-build-142/badge-01.png?v=beta144r1");
      }, true);
    },

    async registerServiceWorker() {
      if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return null;
      try {
        const registration = await (window.tamoonPwa?.getRegistration?.() || navigator.serviceWorker.ready);
        if (!registration) return null;
        if (this.swRegistration === registration) return registration;
        this.swRegistration = registration;
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              this.updateAvailable = { build: "novo", version: "Nova versão" };
              this.renderUpdateBanner();
            }
          });
        });
        navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
        return registration;
      } catch (error) {
        console.warn("Falha ao obter o service worker registrado.", error);
        return null;
      }
    },

    async checkForUpdates(showCurrent = false) {
      try {
        const response = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Não foi possível consultar a versão publicada.");
        const release = await response.json();
        if (Number(release.build || 0) > APP_RELEASE.build) {
          this.updateAvailable = release;
          this.renderUpdateBanner();
          return true;
        }
        if (showCurrent) this.toast(`Você já está na versão mais recente: ${APP_RELEASE.version} Build ${APP_RELEASE.build}.`);
        return false;
      } catch (error) {
        if (showCurrent) this.toast(error.message, true);
        return false;
      }
    },

    renderUpdateBanner() {
      if (!this.updateAvailable || document.getElementById("updateBanner")) return;
      const banner = document.createElement("div");
      banner.id = "updateBanner";
      banner.className = "update-banner";
      banner.innerHTML = `<div><strong>Nova versão disponível</strong><small>Atualize para receber correções e melhorias.</small></div><button type="button" data-action="apply-update">Atualizar agora</button>`;
      document.body.appendChild(banner);
    },

    async applyUpdate() {
      const registration = await this.ensureServiceWorker();
      await registration.update().catch(() => {});
      if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      else {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
        location.reload();
      }
    },

    async ensureServiceWorker() {
      if (this.swRegistration) return this.swRegistration;
      await this.registerServiceWorker();
      return navigator.serviceWorker.ready;
    },

    currentGroup() {
      return (this.state?.groups || []).find(group => group.id === this.state.currentGroupId) || (this.state?.groups || [])[0] || null;
    },
    currentRole() {
      const role = this.currentGroup()?.role || "member";
      return role === "owner" ? "admin" : role;
    },
    canManageGroup() { return this.currentRole() === "admin"; },
    canManageMatches() { return ["admin", "organizer"].includes(this.currentRole()); },
    canManageFinance() { return ["admin", "treasurer"].includes(this.currentRole()); },
    canSeeRatings() { return this.currentRole() === "admin"; },
    activePlayers() { return (this.state?.players || []).filter(player => player.active !== false && !player.guest_match_id); },
    guestPlayers() { return (this.state?.players || []).filter(player => player.active !== false && Boolean(player.guest_match_id)); },
    matchPlayers(matchId) { return (this.state?.players || []).filter(player => player.active !== false && (!player.guest_match_id || player.guest_match_id === matchId)); },
    isGuest(player) { return Boolean(player?.guest_match_id); },
    player(id) { return (this.state?.players || []).find(player => player.id === id); },
    memberPlayer(member) { return this.player(member?.player_id) || (this.state?.players || []).find(player => player.user_id === member?.user_id); },
    myPlayer() {
      const group = this.currentGroup();
      return this.player(group?.player_id) || (this.state?.players || []).find(player => player.user_id === this.state?.profile?.id) || null;
    },
    adminMember() { return (this.state?.members || []).find(member => ["admin", "owner"].includes(member.role)) || null; },
    attendanceFor(matchId) { return this.state?.attendance.filter(item => item.match_id === matchId) || []; },
    confirmedFor(matchId) { return this.attendanceFor(matchId).filter(item => item.status === "confirmed"); },
    waitlistFor(matchId) {
      return this.attendanceFor(matchId)
        .filter(item => item.status === "waitlist")
        .sort((a, b) => Number(a.waitlist_position || 9999) - Number(b.waitlist_position || 9999) || new Date(a.responded_at) - new Date(b.responded_at));
    },
    isHistoricalMatch(match) {
      return Boolean(match && (new Date(match.starts_at) <= new Date() || match.status === "finished"));
    },
    upcomingMatches() {
      return (this.state?.matches || []).filter(match => !this.isHistoricalMatch(match) && !["cancelled", "finished"].includes(match.status)).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    },
    pastMatches() {
      return (this.state?.matches || []).filter(match => this.isHistoricalMatch(match)).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
    },
    nextMatch() { return this.upcomingMatches()[0] || null; },
    ratingSummary(playerId) {
      if (!this.canSeeRatings()) return null;
      const ratings = this.state.member_ratings.filter(item => item.rated_player_id === playerId);
      if (!ratings.length) return { average: null, count: 0 };
      return { average: ratings.reduce((sum, item) => sum + Number(item.score), 0) / ratings.length, count: ratings.length };
    },
    myRating(playerId) {
      return this.state.member_ratings.find(item => item.rated_player_id === playerId && item.rater_user_id === this.state.profile.id) || null;
    },

    groupAvatar(group, className = "group-avatar") {
      return `<img class="${className}" src="${groupAvatarUrl(group?.avatar_key)}" alt="Escudo de ${escapeHtml(group?.name || "grupo")}" data-group-avatar>`;
    },

    personAvatar(player, className = "player-avatar") {
      const url = safeImageUrl(player?.avatar_url || "");
      return url
        ? `<img class="${className} avatar-photo" src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer">`
        : `<div class="${className}">${initials(player?.name || "Jogador")}</div>`;
    },

    render() {
      if (!this.ready || !this.state) return;
      const group = this.currentGroup();
      const groupImg = $("#groupAvatar");
      if (groupImg) {
        groupImg.dataset.fallbackApplied = "false";
        if (group) {
          groupImg.hidden = false;
          groupImg.src = groupAvatarUrl(group.avatar_key);
          groupImg.alt = `Escudo de ${group.name}`;
        } else {
          groupImg.hidden = true;
          groupImg.removeAttribute("src");
          groupImg.alt = "";
        }
      }
      $("#groupName").textContent = group?.name || "Crie ou entre em um grupo";
      $("#syncLabel").textContent = group ? `${roleLabels[this.currentRole()]} · nuvem ativa` : "Conta conectada";
      const profileButton = $("#profileButton");
      const profilePhoto = safeImageUrl(this.state.profile?.avatar_url);
      profileButton.innerHTML = profilePhoto ? `<img src="${escapeHtml(profilePhoto)}" alt="Meu perfil" referrerpolicy="no-referrer">` : initials(this.state.profile?.name || "Usuário");
      const notificationButton = $("#notificationButton");
      if (notificationButton) {
        notificationButton.hidden = !group;
        notificationButton.setAttribute("aria-label", group ? "Abrir avisos do grupo" : "Avisos");
      }
      $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.route === this.route));
      const compactHome = Boolean(group && this.route === "home");
      $("#mainContent")?.classList.toggle("home-compact", compactHome);
      $(".app-shell")?.classList.toggle("home-shell", compactHome);

      if (!group) {
        $("#mainContent").innerHTML = this.emptyGroupPage();
        return;
      }
      const pages = {
        home: () => this.homePage(),
        matches: () => this.matchesPage(),
        teams: () => this.teamsPage(),
        members: () => this.membersPage(),
        finance: () => this.financePage(),
        more: () => this.morePage()
      };
      $("#mainContent").innerHTML = (pages[this.route] || pages.home)();
    },

    emptyGroupPage() {
      return `<section class="welcome-field"><div class="welcome-overlay"><img src="brand/tamo-on-logo-horizontal-negative.svg" alt="" class="welcome-mark"><span class="eyebrow">CONTA GOOGLE CONECTADA</span><h1>Monte seu grupo</h1><p>Crie um grupo com escudo próprio ou entre usando um código de convite.</p><div class="welcome-actions"><button class="btn btn-primary btn-small" data-action="create-group">+ Criar grupo</button><button class="btn btn-secondary btn-small" data-action="join-group">Inserir código</button></div></div></section>`;
    },

    homePage() {
      const group = this.currentGroup();
      const match = this.nextMatch();
      const attendance = match ? this.attendanceFor(match.id) : [];
      const confirmed = attendance.filter(item => item.status === "confirmed");
      const waitlist = attendance.filter(item => item.status === "waitlist");
      const overflow = Math.max(0, confirmed.length - Number(match?.max_players || 0));
      const notice = [...(this.state?.announcements || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      const administrator = this.memberPlayer(this.adminMember());
      const player = this.myPlayer();
      const myAttendance = match && player
        ? attendance.find(item => item.player_id === player.id) || null
        : null;
      const gameAnswer = ["confirmed", "waitlist"].includes(myAttendance?.status)
        ? "confirmed"
        : myAttendance?.status === "out" ? "out" : "";
      const bbqAnswered = Boolean(myAttendance?.bbq_responded);
      const responseButton = (scope, value, label, selected, icon) => `<button type="button" class="home-response-button ${selected ? "is-selected" : ""} ${value === "out" || value === "no" ? "is-negative" : "is-positive"}" data-action="home-${scope}-response" data-id="${match?.id || ""}" data-value="${value}" aria-pressed="${selected ? "true" : "false"}"><span aria-hidden="true">${icon}</span>${label}</button>`;
      const responsePanel = match ? `<div class="home-response-stack" aria-label="Respostas do evento"><div class="home-response-row"><span class="home-response-label">Jogo</span><div class="home-response-actions">${responseButton("game", "confirmed", "Vou", gameAnswer === "confirmed", "✓")}${responseButton("game", "out", "Não vou", gameAnswer === "out", "×")}</div></div>${match.bbq_enabled ? `<div class="home-response-row"><span class="home-response-label">Churrasco</span><div class="home-response-actions">${responseButton("bbq", "yes", "Vou", bbqAnswered && myAttendance?.bbq === true, "✓")}${responseButton("bbq", "no", "Não vou", bbqAnswered && myAttendance?.bbq === false, "×")}</div></div>` : ""}</div>` : "";
      const emblem = this.canManageGroup()
        ? `<button class="hero-avatar-button" data-action="group-settings" aria-label="Personalizar grupo">${this.groupAvatar(group, "hero-group-avatar")}</button>`
        : this.groupAvatar(group, "hero-group-avatar");
      return `<section class="home-dashboard">
        <section class="stadium-hero home-hero">
          <div class="stadium-lights"></div>
          <div class="group-identity">${emblem}<div><span class="eyebrow">${escapeHtml(roleLabels[this.currentRole()])}</span><h1>${escapeHtml(group.name)}</h1><p>Administrador: ${escapeHtml(administrator?.name || "Não identificado")}</p></div></div>
          ${match ? `<div class="next-match-panel"><div class="next-match-heading"><div><span class="match-kicker">PRÓXIMA PELADA</span><h2>${escapeHtml(match.title)}</h2></div><button class="match-detail-link" data-action="open-match" data-id="${match.id}">Detalhes</button></div><p>${escapeHtml(shortDate(match.starts_at))} · ${escapeHtml(match.location)}</p><div class="hero-numbers"><div><strong>${confirmed.length}</strong><small>confirmados</small></div><div><strong>${match.max_players}</strong><small>começam</small></div><div><strong>${overflow || waitlist.length || Math.max(0, Number(match.max_players) - confirmed.length)}</strong><small>${overflow ? "excedentes" : waitlist.length ? "em espera" : "restantes"}</small></div></div>${responsePanel}</div>` : `<div class="next-match-panel empty-match-panel"><span class="match-kicker">AGENDA LIVRE</span><h2>Nenhuma pelada marcada</h2><p>Organizadores podem criar o próximo jogo.</p>${this.canManageMatches() ? '<button class="btn btn-primary btn-small" data-action="new-match">Agendar pelada</button>' : ""}</div>`}
        </section>
        ${notice ? `<button class="home-notice" data-action="announcement-center" data-id="${notice.id}"><span>📣</span><div><strong>${escapeHtml(notice.title)}</strong><small>${escapeHtml(notice.body)}</small></div><b>›</b></button>` : ""}
        <div class="home-quick-grid">
          <button class="quick-card" data-action="rsvp" data-id="${match?.id || ""}"><span class="quick-icon">✓</span><span><strong>Respostas</strong><small>Revise jogo e churrasco</small></span></button>
          <button class="quick-card" data-route="teams"><span class="quick-icon">⇄</span><span><strong>Times</strong><small>Equilíbrio do elenco</small></span></button>
          <button class="quick-card" data-route="members"><span class="quick-icon">★</span><span><strong>Membros</strong><small>Posições e notas</small></span></button>
          <button class="quick-card" data-action="invite"><span class="quick-icon">↗</span><span><strong>Convidar</strong><small>WhatsApp e código</small></span></button>
        </div>
      </section>`;
    },

    matchesPage() {
      const upcoming = this.upcomingMatches();
      const past = this.pastMatches();
      const cards = list => list.length ? list.map(match => this.matchCard(match)).join("") : `<div class="card empty"><strong>Nenhum jogo</strong><span>Os registros aparecerão aqui.</span></div>`;
      return `<div class="page-head"><div><span class="page-kicker">CALENDÁRIO</span><h1>Jogos</h1><p>Próximas peladas e histórico permanente.</p></div>${this.canManageMatches() ? '<button class="btn btn-primary btn-small" data-action="new-match">+ Agendar</button>' : ""}</div><div class="section-title"><h2>Próximos</h2></div><div class="list">${cards(upcoming)}</div><div class="section-title"><h2>Histórico</h2><small>Jogos realizados não podem ser apagados.</small></div><div class="list">${cards(past)}</div>`;
    },

    matchCard(match) {
      const date = new Date(match.starts_at);
      const confirmed = this.confirmedFor(match.id);
      const waitlist = this.waitlistFor(match.id);
      const future = !this.isHistoricalMatch(match);
      const recurring = Number(match.recurrence_total || 1) > 1;
      return `<article class="card match-card" data-action="open-match" data-id="${match.id}" role="button" tabindex="0" aria-label="Abrir detalhes de ${escapeHtml(match.title)}"><div class="match-top"><div class="match-date"><small>${date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "").toUpperCase()}</small><strong>${String(date.getDate()).padStart(2, "0")}</strong></div><div class="match-info"><h3>${escapeHtml(match.title)}</h3><p>${escapeHtml(shortDate(match.starts_at))}<br>${escapeHtml(match.location)}</p>${recurring ? '<span class="recurrence-chip">↻ Semanal</span>' : ""}${match.bbq_enabled ? '<span class="bbq-chip">Churrasco</span>' : ""}</div><span class="status-pill ${future ? "status-maybe" : "status-confirmed"}">${future ? "Agendado" : "Histórico"}</span></div><div class="match-footer"><div class="avatar-stack">${confirmed.slice(0, 5).map(item => `<span>${initials(this.player(item.player_id)?.name)}</span>`).join("")}${confirmed.length > 5 ? `<span>+${confirmed.length - 5}</span>` : ""}</div><span class="match-open-label">${confirmed.length}/${match.max_players} começam${waitlist.length ? ` · ${waitlist.length} espera` : ""} <b>›</b></span></div></article>`;
    },

    teamsPage() {
      const explicitlySelected = (this.state?.matches || []).find(item => item.id === this.selectedTeamMatchId) || null;
      const historicalMatch = this.selectedTeamMatchHistoryMode && this.isHistoricalMatch(explicitlySelected)
        ? explicitlySelected
        : null;
      const selectedFutureMatch = !this.selectedTeamMatchHistoryMode && explicitlySelected && !this.isHistoricalMatch(explicitlySelected)
        ? explicitlySelected
        : null;
      const match = historicalMatch || selectedFutureMatch || this.nextMatch();

      if (!match) {
        this.selectedTeamMatchId = "";
        this.selectedTeamMatchHistoryMode = false;
        return `<div class="page-head"><div><span class="page-kicker">ESCALAÇÃO</span><h1>Times</h1><p>Separação por posição e avaliação.</p></div></div><div class="card empty"><strong>Nenhum evento futuro disponível</strong><span>Os times de jogos já realizados ficam disponíveis somente no histórico de cada evento, pelo botão Abrir Times.</span></div>`;
      }

      const historical = this.isHistoricalMatch(match);
      this.selectedTeamMatchId = match.id;
      this.selectedTeamMatchHistoryMode = historical;
      const confirmed = this.confirmedFor(match.id).map(item => this.player(item.player_id)).filter(Boolean);
      const assignments = this.state.assignments.filter(item => item.match_id === match.id);
      const teams = [...new Set(assignments.map(item => item.team_name))];

      if (historical) {
        return `<div class="page-head"><div><span class="page-kicker">HISTÓRICO DA PARTIDA</span><h1>Times</h1><p>${escapeHtml(match.title)} · ${escapeHtml(shortDate(match.starts_at))}</p></div><button type="button" class="btn btn-secondary btn-small" data-route="matches">Voltar aos jogos</button></div><div class="content-stack"><div class="notice notice-history"><strong>Registro somente para consulta</strong><br>A partida já foi finalizada. A divisão permanece preservada no histórico e não pode mais ser rebalanceada ou desfeita.</div>${teams.length ? `<div class="team-grid">${teams.map(name => this.teamCard(name, assignments)).join("")}</div>` : `<div class="card empty"><strong>Nenhuma separação registrada</strong><span>Este evento foi finalizado sem uma divisão de times salva.</span></div>`}</div>`;
      }

      const maximumTeams = Math.min(12, Math.max(2, confirmed.length));
      const inferredTeams = match.players_per_team
        ? Math.max(2, Math.ceil(confirmed.length / Math.max(2, Number(match.players_per_team))))
        : 2;
      const selectedTeamCount = Math.min(maximumTeams, Math.max(2, Number(match.team_count || inferredTeams || 2)));
      const teamOptions = Array.from({ length: Math.max(0, maximumTeams - 1) }, (_, index) => index + 2)
        .map(count => `<option value="${count}" ${count === selectedTeamCount ? "selected" : ""}>${count} times</option>`).join("");
      const configPanel = this.canManageMatches()
        ? `<section class="card team-config-card"><div class="team-config-copy"><strong>Quantidade de times</strong><small>Defina quantas equipes serão formadas nesta partida. A escolha fica salva para novos rebalanceamentos.</small></div><div class="team-config-controls"><select id="teamCountSelect" aria-label="Quantidade de times" ${confirmed.length < 2 ? "disabled" : ""}>${teamOptions}</select><div class="team-config-actions"><button type="button" class="btn btn-primary" data-action="configure-teams" data-id="${match.id}" ${confirmed.length < 2 ? "disabled" : ""}>${assignments.length ? "Rebalancear" : "Separar"}</button>${assignments.length ? `<button type="button" class="btn btn-secondary team-clear-button" data-action="clear-teams" data-id="${match.id}">Desfazer separação</button>` : ""}</div></div>${assignments.length ? '<small class="team-config-reference">Desfazer remove somente os times formados. Confirmações, sorteio da espera e quantidade configurada de times são preservados.</small>' : match.players_per_team ? `<small class="team-config-reference">Referência informada no evento: ${Number(match.players_per_team)} jogadores por time.</small>` : '<small class="team-config-reference">O evento não possui quantidade fixa de jogadores por time.</small>'}</section>`
        : "";
      return `<div class="page-head"><div><span class="page-kicker">ESCALAÇÃO</span><h1>Times</h1><p>${escapeHtml(match.title)} · ${confirmed.length} confirmados</p></div></div>${configPanel}<div class="content-stack"><div class="notice"><strong>Equilíbrio confidencial</strong><br>O servidor prioriza goleiros principais e, quando necessário, completa a posição com quem marcou “Também posso jogar no gol”. Sem opções suficientes, a separação continua normalmente. As avaliações permanecem confidenciais.</div>${teams.length ? `<div class="team-grid">${teams.map(name => this.teamCard(name, assignments)).join("")}</div>` : `<div class="card empty"><strong>Times ainda não formados</strong><span>${confirmed.length < 2 ? "Aguarde mais confirmações." : "Escolha a quantidade de times e use o botão Separar."}</span></div>`}</div><div class="section-title"><h2>Confirmados</h2></div><div class="list">${confirmed.map(player => this.playerRow(player, { showRating: this.canSeeRatings() })).join("") || '<div class="card empty">Nenhum confirmado.</div>'}</div>`;
    },

    teamCard(name, assignments) {
      const members = assignments
        .filter(item => item.team_name === name)
        .sort((a, b) => a.slot - b.slot)
        .map(assignment => ({ assignment, player: this.player(assignment.player_id) }))
        .filter(item => Boolean(item.player));
      const definedGoalkeeper = members.some(item => item.assignment.assigned_goalkeeper === true);
      return `<section class="card team-card"><div class="team-head"><div class="team-shirt">${name.includes("Verde") ? "🟢" : name.includes("Azul") ? "🔵" : name.includes("Laranja") ? "🟠" : "⚪"}</div><strong>${escapeHtml(name)}</strong><small>${members.length} jogadores${definedGoalkeeper ? " · goleiro definido" : " · sem goleiro definido"}</small></div>${members.map(({ player, assignment }) => { const summary = this.ratingSummary(player.id); return `<div class="team-player ${assignment.assigned_goalkeeper ? "is-assigned-goalkeeper" : ""}">${this.personAvatar(player)}<div class="list-main"><strong>${escapeHtml(player.nickname || player.name)}</strong><small>${playerPositionHtml(player, { designated: assignment.assigned_goalkeeper === true })}${summary?.average ? ` · nota ${summary.average.toFixed(1)}` : ""}</small></div><div class="team-player-trailing">${this.isGuest(player) ? '<span class="guest-badge">Convidado</span>' : ""}</div></div>`; }).join("")}</section>`;
    },

    membersPage() {
      const sortedMembers = [...(this.state?.members || [])].sort((a, b) => {
        const weight = { owner: 0, admin: 0, organizer: 1, treasurer: 2, member: 3 };
        return (weight[a.role] - weight[b.role]) || String(this.memberPlayer(a)?.name).localeCompare(String(this.memberPlayer(b)?.name));
      });
      return `<div class="page-head members-page-head"><div><span class="page-kicker">ELENCO</span><h1>Membros do grupo</h1><p>Funções, posições e avaliações internas.</p></div><button class="btn btn-primary btn-small" data-action="invite">Convidar</button></div><div class="members-primary-action"><button class="btn btn-primary btn-block" data-action="rate-members">★ Avaliar membros</button></div><div class="section-title members-list-title"><h2>Elenco (${sortedMembers.length})</h2>${this.canSeeRatings() ? '<small>Notas visíveis somente ao administrador.</small>' : '<small>Avaliações confidenciais.</small>'}</div><div class="list members-list">${sortedMembers.map(member => this.memberRow(member)).join("")}</div>${this.canSeeRatings() ? this.privateRatingsPanel() : ""}`;
    },

    memberRow(member) {
      const player = this.memberPlayer(member) || { name: "Membro", primary_position: "Sem posição" };
      const summary = this.ratingSummary(player.id);
      const isMe = member.user_id === this.state.profile.id;
      const canManageMember = this.canManageMatches() && !isMe && !["admin", "owner"].includes(member.role);
      return `<article class="card member-row member-row-compact ${canManageMember ? "member-row-manageable" : ""}" ${canManageMember ? `data-action="manage-member" data-user-id="${member.user_id}" role="button" tabindex="0" aria-label="Gerenciar ${escapeHtml(player.name)}"` : ""}>${this.personAvatar(player)}<div class="list-main"><strong>${escapeHtml(player.name)}${isMe ? ' <span class="you-label">você</span>' : ""}</strong><small>${playerPositionHtml(player)}${player.nickname ? ` · ${escapeHtml(player.nickname)}` : ""}</small></div><div class="member-trailing"><span class="role-pill ${roleClass(member.role)}">${escapeHtml(roleLabels[member.role] || "Membro")}</span>${this.canSeeRatings() ? `<small class="private-score">${summary?.average ? `★ ${summary.average.toFixed(1)} (${summary.count})` : "Sem notas"}</small>` : ""}${canManageMember ? '<span class="member-manage-chevron">›</span>' : ""}</div></article>`;
    },

    privateRatingsPanel() {
      const rated = this.activePlayers().map(player => ({ player, summary: this.ratingSummary(player.id) })).filter(item => item.summary?.count).sort((a, b) => b.summary.average - a.summary.average);
      return `<div class="section-title"><h2>Painel privado de notas</h2><span class="private-badge">🔒 Administrador</span></div><section class="card private-panel">${rated.length ? rated.map((item, index) => `<div class="rating-summary-row"><span class="rank-pos">${index + 1}</span>${this.personAvatar(item.player)}<div class="list-main"><strong>${escapeHtml(item.player.name)}</strong><small>${playerPositionHtml(item.player)} · ${item.summary.count} avaliação(ões)</small></div><strong>${item.summary.average.toFixed(2)}</strong></div>`).join("") : '<div class="empty"><strong>Nenhuma média disponível</strong><span>As notas aparecerão após os membros avaliarem o elenco.</span></div>'}</section>`;
    },

    playerRow(player, options = {}) {
      const summary = options.showRating ? this.ratingSummary(player.id) : null;
      return `<div class="card list-row">${this.personAvatar(player)}<div class="list-main"><strong>${escapeHtml(player.name)}</strong><small>${playerPositionHtml(player)} · ${player.games || 0} jogos</small></div>${summary?.average ? `<span class="score-pill">★ ${summary.average.toFixed(1)}</span>` : ""}</div>`;
    },

    financePage() {
      const payments = this.state.payments;
      const expenses = this.state.expenses;
      const income = payments.reduce((sum, item) => sum + Number(item.amount), 0);
      const out = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
      const chargeSummaries = this.state.charges.map(charge => {
        const amount = Number(charge.amount || 0);
        const paidAmount = payments
          .filter(payment => payment.charge_id === charge.id)
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const remaining = Math.max(0, amount - paidAmount);
        const effectiveStatus = charge.status === "cancelled"
          ? "cancelled"
          : paidAmount >= amount && amount > 0
            ? "paid"
            : paidAmount > 0
              ? "partial"
              : charge.status;
        return { ...charge, amount, paidAmount, remaining, effectiveStatus };
      });
      const activeCharges = chargeSummaries.filter(charge => charge.effectiveStatus !== "cancelled");
      const totalCharged = activeCharges.reduce((sum, charge) => sum + charge.amount, 0);
      const totalApplied = activeCharges.reduce((sum, charge) => sum + Math.min(charge.paidAmount, charge.amount), 0);
      const paid = chargeSummaries.filter(charge => charge.effectiveStatus === "paid").length;
      const partial = chargeSummaries.filter(charge => charge.effectiveStatus === "partial").length;
      const pct = totalCharged ? Math.min(100, Math.round(totalApplied / totalCharged * 100)) : 0;
      const canDelete = this.canManageFinance();
      const movements = [
        ...payments.map(item => {
          const linkedCharge = this.state.charges.find(charge => charge.id === item.charge_id);
          const linkedPlayer = this.player(item.player_id || linkedCharge?.player_id);
          return {
            ...item,
            entryType: "payment",
            type: "income",
            description: item.description || `Pagamento · ${linkedPlayer?.nickname || linkedPlayer?.name || "Jogador"}`,
            linkedMemberName: linkedPlayer?.name || linkedPlayer?.nickname || "",
            date: item.paid_at
          };
        }),
        ...expenses.map(item => ({ ...item, entryType: "expense", type: "expense", date: item.occurred_at }))
      ].sort((a, b) => new Date(b.date) - new Date(a.date));
      const statusPresentation = status => ({
        paid: ["status-confirmed", "Pago"],
        partial: ["status-maybe", "Parcial"],
        overdue: ["status-out", "Vencida"],
        cancelled: ["status-out", "Cancelada"],
        open: ["status-out", "Pendente"]
      }[status] || ["status-out", "Pendente"]);
      const chargeRows = chargeSummaries.map(charge => {
        const player = this.player(charge.player_id) || { name: "Grupo", primary_position: charge.description };
        const [statusClass, statusLabel] = statusPresentation(charge.effectiveStatus);
        const paymentDetails = charge.paidAmount > 0
          ? `<small class="finance-charge-progress ${charge.effectiveStatus === "partial" ? "is-partial" : ""}">Pago: ${money(charge.paidAmount)} · ${charge.remaining > 0 ? `Restante: ${money(charge.remaining)}` : "Cobrança quitada"}</small>`
          : "";
        return `<div class="card list-row finance-charge-row">${this.personAvatar(player)}<div class="list-main"><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(charge.description)} · Total: ${money(charge.amount)}</small>${paymentDetails}</div><span class="status-pill ${statusClass}">${statusLabel}</span>${canDelete ? `<button class="row-delete-button" data-action="delete-finance" data-type="charge" data-id="${charge.id}" aria-label="Excluir cobrança">×</button>` : ""}</div>`;
      }).join("");
      return `<div class="page-head"><div><span class="page-kicker">FINANCEIRO</span><h1>Caixa</h1><p>Mensalidades, quadra, materiais e churrasco.</p></div>${canDelete ? '<div class="page-head-actions"><button class="btn btn-secondary btn-small" data-action="batch-charge">Cobrança em lote</button><button class="btn btn-secondary btn-small" data-action="batch-payment">Baixar em lote</button><button class="btn btn-primary btn-small" data-action="new-finance">+ Lançar</button></div>' : ""}</div><div class="content-stack">${!canDelete ? '<div class="notice"><strong>Acesso de consulta</strong><br>Somente administrador e tesoureiro podem alterar lançamentos.</div>' : '<div class="notice notice-success"><strong>Acesso autorizado</strong><br>Você pode registrar e excluir cobranças, pagamentos e despesas.</div>'}<section class="card balance-card"><small>Saldo atual</small><h2>${money(income - out)}</h2><div class="balance-grid"><div><small>Entradas</small><strong>${money(income)}</strong></div><div><small>Saídas</small><strong>${money(out)}</strong></div></div><div class="balance-track"><span style="width:${pct}%"></span></div><p>${paid} paga(s) · ${partial} parcial(is) · ${pct}% do valor cobrado recebido</p></section></div><div class="section-title"><h2>Movimentações</h2></div><div class="list">${movements.map(item => `<div class="card finance-row"><div class="finance-icon ${item.type === "income" ? "finance-income" : "finance-expense"}">${item.type === "income" ? "+" : "−"}</div><div class="list-main"><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(shortDate(item.date))}</small></div><div class="finance-value-bubble ${item.type === "income" ? "is-income" : "is-expense"}"><strong class="money ${item.type === "income" ? "positive" : "negative"}">${item.type === "income" ? "+" : "−"}${money(item.amount)}</strong>${item.type === "income" && item.linkedMemberName ? `<small>Membro: ${escapeHtml(item.linkedMemberName)}</small>` : ""}</div>${canDelete ? `<button class="row-delete-button" data-action="delete-finance" data-type="${item.entryType}" data-id="${item.id}" aria-label="Excluir lançamento">×</button>` : ""}</div>`).join("") || '<div class="card empty">Sem movimentações.</div>'}</div><div class="section-title"><h2>Cobranças</h2></div><div class="list">${chargeRows || '<div class="card empty">Nenhuma cobrança.</div>'}</div>`;
    },

    morePage() {
      const group = this.currentGroup();
      const pushConfigured = Boolean(String(window.TAMOON_CONFIG?.vapidPublicKey || "").trim());
      const pushText = !pushSupported() ? "Este navegador não oferece notificações push." : !pushConfigured ? "Conclua a configuração VAPID." : "Receba avisos mesmo com o aplicativo fechado.";
      const adminTools = this.state.is_platform_admin ? '<div class="section-title"><h2>Operação do beta</h2><small>Acesso exclusivo da plataforma.</small></div><button class="card menu-row admin-menu-row" data-action="platform-admin"><span class="menu-icon">◉</span><div class="list-main"><strong>Painel Beta</strong><small>Saúde, métricas, feedbacks e logs.</small></div><strong>›</strong></button><button class="card menu-row admin-menu-row" data-action="export"><span class="menu-icon">⇩</span><div class="list-main"><strong>Exportar backup integral do grupo</strong><small>Arquivo JSON restrito à administração da plataforma.</small></div><strong>›</strong></button>' : "";
      return `<div class="page-head"><div><span class="page-kicker">CONFIGURAÇÕES</span><h1>Mais</h1><p>Administração, suporte e dados da conta.</p></div></div><div class="list"><button class="card menu-row" data-action="profile"><span class="menu-icon">⚽</span><div class="list-main"><strong>Meu perfil de jogador</strong><small>Nome, apelido e posição.</small></div><strong>›</strong></button><button class="card menu-row" data-action="notification-settings"><span class="menu-icon">🔔</span><div class="list-main"><strong>Notificações no celular</strong><small>${escapeHtml(pushText)}</small></div><strong>›</strong></button><button class="card menu-row" data-action="announcement-center"><span class="menu-icon">📣</span><div class="list-main"><strong>Central de avisos</strong><small>Consulte os comunicados do grupo.</small></div><strong>›</strong></button><button class="card menu-row" data-action="invite"><span class="menu-icon">↗</span><div class="list-main"><strong>Convidar pelo WhatsApp</strong><small>Código ${escapeHtml(group.invite_code)}</small></div><strong>›</strong></button>${this.canManageGroup() ? '<button class="card menu-row" data-action="group-settings"><span class="menu-icon">🛡</span><div class="list-main"><strong>Personalizar grupo</strong><small>Nome, escudo e administração.</small></div><strong>›</strong></button><button class="card menu-row" data-action="manage-roles"><span class="menu-icon">♟</span><div class="list-main"><strong>Gerenciar funções</strong><small>Administrador, organizador e tesoureiro.</small></div><strong>›</strong></button>' : ""}${this.canManageMatches() ? '<button class="card menu-row" data-action="announcement"><span class="menu-icon">!</span><div class="list-main"><strong>Publicar aviso</strong><small>Enviar comunicado e notificação ao elenco.</small></div><strong>›</strong></button><button class="card menu-row" data-action="players"><span class="menu-icon">+</span><div class="list-main"><strong>Jogadores sem acesso</strong><small>Cadastrar convidado eventual.</small></div><strong>›</strong></button>' : ""}<div class="section-title"><h2>Suporte do beta</h2></div><button class="card menu-row feedback-row" data-action="report-problem"><span class="menu-icon">⚑</span><div class="list-main"><strong>Reportar problema</strong><small>Envie o relato com diagnóstico automático.</small></div><strong>›</strong></button><button class="card menu-row" data-action="about-diagnostics"><span class="menu-icon">i</span><div class="list-main"><strong>Sobre e diagnóstico</strong><small>Versão, sincronização, push e atualização.</small></div><strong>›</strong></button>${adminTools}<button class="card menu-row danger-row" data-action="sign-out"><span class="menu-icon danger-avatar">↪</span><div class="list-main"><strong>Sair da conta</strong><small>Desconectar e escolher outra conta Google.</small></div><strong>›</strong></button></div><div class="version-card">Tâmo On ${APP_RELEASE.version} · Build ${APP_RELEASE.build} · Beta fechado</div>`;
    },

    async handleAction(action, data) {
      try {
        const actions = {
          "new-match": () => this.openMatchForm(),
          "open-match": () => this.openMatchDetails(data.id),
          rsvp: () => this.openRsvp(data.id || this.nextMatch()?.id),
          "home-game-response": () => this.setHomeGameResponse(data.id, data.value),
          "home-bbq-response": () => this.setHomeBbqResponse(data.id, data.value),
          "draw-teams": () => this.openTeamsForMatch(data.id),
          "configure-teams": () => this.drawTeams(data.id, Number($("#teamCountSelect")?.value || 2)),
          "clear-teams": () => this.undoTeamSeparation(data.id),
          "new-finance": () => this.openFinanceForm(),
          "batch-charge": () => this.openBatchChargeForm(),
          "batch-payment": () => this.openBatchPaymentForm(),
          "delete-finance": () => this.deleteFinanceEntry(data.type, data.id),
          "rate-members": () => this.openMemberRatings(),
          players: () => this.openPlayers(),
          group: () => this.openGroupModal(),
          "create-group": () => this.openCreateGroupModal(),
          "join-group": () => this.openJoinGroupModal(),
          invite: () => this.openInviteModal(),
          "group-settings": () => this.openGroupSettings(),
          "manage-roles": () => this.openRoleManager(),
          "manage-member": () => this.openMemberManager(data.userId),
          announcement: () => this.openAnnouncementForm(),
          "announcement-center": () => this.openAnnouncementCenter(data.id),
          "notification-settings": () => this.openNotificationSettings(),
          profile: () => this.openProfileModal(),
          export: () => this.exportData(),
          "report-problem": () => this.openProblemReport(),
          "about-diagnostics": () => this.openDiagnostics(),
          "platform-admin": () => this.openPlatformAdmin(),
          "apply-update": () => this.applyUpdate(),
          "check-update": () => this.checkForUpdates(true),
          "sign-out": () => this.logout(),
          reload: () => location.reload()
        };
        if (["new-match", "rsvp", "new-finance", "batch-charge", "batch-payment", "create-group", "join-group", "announcement", "report-problem"].includes(action)) this.repo?.logEvent("ui_action", { action });
        if (actions[action]) await actions[action]();
      } catch (error) {
        console.error(error);
        this.toast(error.message || "Não foi possível concluir a ação.", true);
      }
    },

    renderBetaAccessDenied(error) {
      clearInterval(this.accessCheckTimer);
      const email = this.repo?.state?.profile?.email || "E-mail não identificado";
      const hasIdentifiedEmail = email !== "E-mail não identificado";
      document.body.innerHTML = `<main class="auth-screen"><section class="auth-panel simple-auth access-denied-panel"><img src="/brand/tamo-on-logo-horizontal-negative.svg" class="auth-brand-logo" alt="Tâmo On"><span class="access-denied-icon">!</span><h1>Aguardando liberação</h1><p>O Tâmo On está em beta fechado. Antes de continuar, a administração precisa autorizar a conta Google usada no login.</p><div class="denied-account-card"><small>CONTA UTILIZADA</small><div><strong id="deniedAccountEmail">${escapeHtml(email)}</strong>${hasIdentifiedEmail ? '<button id="copyDeniedEmail" class="copy-email-button" type="button" aria-label="Copiar e-mail">Copiar</button>' : ''}</div></div><div class="notice auth-error"><strong>Situação do acesso</strong><br><span id="deniedAccessMessage">${escapeHtml(error?.message || "Este e-mail ainda não está autorizado.")}</span></div><div class="access-denied-instructions"><strong>Como liberar</strong><ol><li>Envie o e-mail acima para a administração do beta.</li><li>Aguarde a confirmação de que o acesso foi autorizado.</li><li>Volte a esta tela e toque em <b>Verificar liberação</b>.</li></ol></div><div id="deniedCheckStatus" class="denied-check-status" role="status" aria-live="polite"></div><button id="deniedCheckAccess" class="btn btn-primary btn-block">Verificar liberação</button><button id="deniedSignOut" class="btn btn-secondary btn-block">Sair e usar outra conta</button></section></main><div id="toastRoot" class="toast-root"></div>`;

      $("#copyDeniedEmail")?.addEventListener("click", async event => {
        try {
          await navigator.clipboard.writeText(email);
          event.currentTarget.textContent = "Copiado";
          setTimeout(() => { if (event.currentTarget) event.currentTarget.textContent = "Copiar"; }, 1500);
        } catch {
          this.toast("Não foi possível copiar o e-mail.", true);
        }
      });

      $("#deniedCheckAccess")?.addEventListener("click", async event => {
        const button = event.currentTarget;
        const status = $("#deniedCheckStatus");
        button.disabled = true;
        button.textContent = "Verificando...";
        status.className = "denied-check-status is-checking";
        status.textContent = "Consultando a autorização desta conta...";
        try {
          await this.repo.claimBetaAccess();
          status.className = "denied-check-status is-success";
          status.textContent = "Acesso liberado. Carregando o aplicativo...";
          setTimeout(() => location.reload(), 450);
        } catch (checkError) {
          if (checkError?.betaAccessDenied || /beta fechado|acesso ao beta|não está autorizado|acesso.*bloqueado/i.test(checkError?.message || "")) {
            status.className = "denied-check-status is-pending";
            status.textContent = "O acesso ainda não foi liberado. Confirme com a administração se este é o e-mail autorizado.";
            $("#deniedAccessMessage").textContent = checkError.message || "Este e-mail ainda não está autorizado.";
          } else {
            status.className = "denied-check-status is-error";
            status.textContent = "Não foi possível verificar agora. Confira sua conexão e tente novamente.";
          }
          button.disabled = false;
          button.textContent = "Verificar liberação";
        }
      });

      $("#deniedSignOut")?.addEventListener("click", async () => {
        try { await this.repo.signOut(); } catch {}
        location.reload();
      });
    },

    renderAuth() {
      const error = oauthErrorFromLocation();
      document.body.innerHTML = `<main class="auth-screen"><section class="auth-panel"><div class="auth-stadium"><div class="auth-lights"></div><img src="/brand/tamo-on-logo-horizontal-negative.svg" class="auth-brand-logo" alt="Tâmo On"><span class="auth-kicker">SUA PELADA. SEU GRUPO. SEU APP.</span></div><div class="auth-copy"><h1>Entre em campo</h1><p>Presença, times equilibrados, membros, caixa e churrasco em um único lugar.</p>${error ? `<div class="notice auth-error"><strong>Falha no login</strong><br>${escapeHtml(error)}</div>` : ""}<div class="google-card"><button id="googleLoginButton" class="google-oauth-button" type="button" aria-label="Continuar com Google"><svg class="google-g" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.23c1.89-1.74 2.99-4.3 2.99-7.41Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.36l-3.23-2.54c-.9.6-2.04.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.07v2.62A9.99 9.99 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.93A6.02 6.02 0 0 1 6.08 12c0-.67.12-1.32.32-1.93V7.45H3.07A10 10 0 0 0 2 12c0 1.61.38 3.14 1.07 4.55l3.33-2.62Z"/><path fill="#EA4335" d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a9.99 9.99 0 0 0-8.93 5.45l3.33 2.62C7.19 7.7 9.4 5.94 12 5.94Z"/></svg><span>Continuar com Google</span><span class="google-login-spinner" aria-hidden="true"></span></button><p id="googleLoginMessage">Use sua conta Google para continuar. Não há cadastro por e-mail ou senha.</p></div><div class="auth-features"><span>✓ Acesso seguro</span><span>✓ Dados em nuvem</span><span>✓ Sincronização entre celulares</span></div></div></section></main><div id="toastRoot" class="toast-root"></div>`;
      this.setupGoogleLogin();
      if (error && history.replaceState) history.replaceState({}, document.title, location.pathname);
    },

    setupGoogleLogin() {
      const button = $("#googleLoginButton");
      const message = $("#googleLoginMessage");
      if (!button) return;

      button.addEventListener("click", async () => {
        if (button.disabled) return;
        button.disabled = true;
        button.classList.add("is-loading");
        message.textContent = "Abrindo o acesso seguro do Google…";
        message.classList.remove("error-text");

        try {
          const { data, error } = await this.repo.signInWithGoogleOAuth();
          if (error) throw error;
          if (!data?.url) throw new Error("O endereço de autenticação não foi gerado.");
          window.location.assign(data.url);
        } catch (error) {
          console.error(error);
          button.disabled = false;
          button.classList.remove("is-loading");
          message.textContent = error?.message || "Não foi possível iniciar o login Google.";
          message.classList.add("error-text");
        }
      });
    },

    renderConfigurationError() {
      document.body.innerHTML = `<main class="auth-screen"><section class="auth-panel simple-auth"><img src="/brand/tamo-on-logo-horizontal-negative.svg" class="auth-brand-logo" alt="Tâmo On"><h1>Configuração necessária</h1><p>Preencha Supabase URL e Publishable key no arquivo <code>supabase-config.js</code>.</p><button class="btn btn-primary" data-action="reload">Verificar novamente</button></section></main>`;
    },

    renderBackendError(error) {
      document.body.innerHTML = `<main class="auth-screen"><section class="auth-panel simple-auth"><img src="/brand/tamo-on-logo-horizontal-negative.svg" class="auth-brand-logo" alt="Tâmo On"><h1>Falha na conexão</h1><p>${escapeHtml(error?.message || "Não foi possível acessar o backend.")}</p><button class="btn btn-primary" data-action="reload">Tentar novamente</button></section></main>`;
    },

    modal(title, content, onReady) {
      const root = $("#modalRoot");
      root.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true"><section class="modal"><div class="modal-handle"></div><div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-close" aria-label="Fechar">×</button></div><div class="modal-content">${content}</div></section></div>`;
      const close = () => { root.innerHTML = ""; };
      $(".modal-close", root).addEventListener("click", close);
      $(".modal-backdrop", root).addEventListener("click", event => { if (event.target.classList.contains("modal-backdrop")) close(); });
      onReady?.(root, close);
    },

    avatarPicker(selected = "badge-01") {
      return `<div class="avatar-picker">${Array.from({ length: 20 }, (_, index) => {
        const key = `badge-${String(index + 1).padStart(2, "0")}`;
        return `<label class="avatar-option"><input type="radio" name="avatar_key" value="${key}" ${key === avatarKey(selected) ? "checked" : ""}><img src="${groupAvatarUrl(key)}" alt="Escudo ${index + 1}"><span>✓</span></label>`;
      }).join("")}</div>`;
    },

    openGroupModal(prefillCode = "") {
      const groups = Array.isArray(this.state?.groups) ? this.state.groups : [];
      const current = this.currentGroup();
      const list = groups.length
        ? `<div class="list group-list">${groups.map(group => {
            const editable = ["owner", "admin"].includes(group.role);
            return `<article class="card group-list-card"><button class="group-icon-action" data-edit-group="${group.id}" aria-label="${editable ? "Personalizar" : "Abrir"} ${escapeHtml(group.name)}">${this.groupAvatar(group)}</button><button class="group-select-action" data-group-id="${group.id}"><span class="list-main"><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(roleLabels[group.role])} · ${escapeHtml(group.invite_code)}</small></span>${group.id === current?.id ? '<span class="score-pill">Atual</span>' : '<strong>›</strong>'}</button></article>`;
          }).join("")}</div>`
        : `<div class="card empty compact-empty"><strong>Nenhum grupo ainda</strong><span>Crie o primeiro grupo ou entre com um código.</span></div>`;
      this.modal("Meus grupos", `<div class="group-modal-actions"><button class="btn btn-primary btn-small" id="openCreateGroup">+ Criar grupo</button><button class="btn btn-secondary btn-small" id="openJoinGroup">Inserir código</button></div>${list}`, (root, close) => {
        $("#openCreateGroup", root).addEventListener("click", () => { close(); setTimeout(() => this.openCreateGroupModal(), 0); });
        $("#openJoinGroup", root).addEventListener("click", () => { close(); setTimeout(() => this.openJoinGroupModal(prefillCode || this.pendingInvite), 0); });
        $$("[data-group-id]", root).forEach(button => button.addEventListener("click", async () => {
          await this.repo.loadGroup(button.dataset.groupId);
          this.state = this.repo.state;
          localStorage.setItem("tamoon-current-group", button.dataset.groupId);
          close();
          this.render();
        }));
        $$("[data-edit-group]", root).forEach(button => button.addEventListener("click", async () => {
          const group = groups.find(item => item.id === button.dataset.editGroup);
          await this.repo.loadGroup(button.dataset.editGroup);
          this.state = this.repo.state;
          localStorage.setItem("tamoon-current-group", button.dataset.editGroup);
          close();
          this.render();
          if (["owner", "admin"].includes(group?.role)) setTimeout(() => this.openGroupSettings(), 0);
        }));
      });
    },

    openCreateGroupModal() {
      this.modal("Criar grupo", `<form id="createGroupForm" class="form-grid create-group-form"><div class="notice notice-success"><strong>Seu grupo, sua identidade</strong><br>Escolha um nome e um escudo. Você será o administrador do grupo.</div><div class="field"><label>Nome do grupo</label><input name="name" required minlength="2" maxlength="80" placeholder="Ex.: Grupo de quinta" autocomplete="off"></div><div class="field"><label>Escolha o escudo</label>${this.avatarPicker()}</div><button class="btn btn-primary btn-block">Criar grupo</button></form>`, (root, close) => {
        $("#createGroupForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await this.repo.createGroup(form.get("name"), form.get("avatar_key"));
          this.state = this.repo.state;
          localStorage.setItem("tamoon-current-group", this.state.currentGroupId);
          close();
          this.route = "home";
          this.render();
          this.toast("Grupo criado. Você é o administrador.");
        });
      });
    },

    openJoinGroupModal(prefillCode = "") {
      this.modal("Entrar em um grupo", `<form id="joinGroupForm" class="form-grid"><div class="notice"><strong>Código de convite</strong><br>Peça o código ao administrador do grupo.</div><div class="field"><label>Código</label><input name="code" required value="${escapeHtml(prefillCode || this.pendingInvite)}" placeholder="Ex.: A1B2C3D4" autocapitalize="characters" autocomplete="off"></div><button class="btn btn-primary btn-block">Entrar no grupo</button></form>`, (root, close) => {
        $("#joinGroupForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await this.repo.joinGroup(form.get("code"));
          this.state = this.repo.state;
          localStorage.removeItem("tamoon-pending-invite");
          this.pendingInvite = "";
          localStorage.setItem("tamoon-current-group", this.state.currentGroupId);
          close();
          this.route = "home";
          this.render();
          this.toast("Você entrou no grupo como membro.");
        });
      });
    },

    openGroupSettings() {
      if (!this.canManageGroup()) return this.toast("Apenas o administrador pode personalizar o grupo.", true);
      const group = this.currentGroup();
      const deleteArea = `<div class="danger-zone"><div><strong>Excluir grupo permanentemente</strong><p>Apaga jogos, histórico, caixa, avaliações, avisos e todos os vínculos. Não existe recuperação.</p></div><button type="button" class="btn btn-danger btn-block" id="openDeleteGroup">Excluir grupo</button></div>`;
      this.modal("Personalizar grupo", `<form id="groupSettingsForm" class="form-grid"><div class="field"><label>Nome</label><input name="name" value="${escapeHtml(group.name)}" required></div><div class="field"><label>Escudo</label>${this.avatarPicker(group.avatar_key)}</div><button class="btn btn-primary btn-block">Salvar alterações</button></form>${deleteArea}`, (root, close) => {
        $("#groupSettingsForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await this.repo.updateGroup(group.id, form.get("name"), form.get("avatar_key"));
          this.state = this.repo.state;
          close();
          this.render();
          this.toast("Grupo atualizado.");
        });
        $("#openDeleteGroup", root)?.addEventListener("click", () => {
          close();
          setTimeout(() => this.openDeleteGroupConfirmation(group), 0);
        });
      });
    },

    openDeleteGroupConfirmation(group) {
      if (this.currentRole() !== "admin") return this.toast("Somente o administrador pode excluir o grupo.", true);
      this.modal("Excluir grupo", `<form id="deleteGroupForm" class="form-grid"><div class="destructive-warning"><span>!</span><div><strong>Exclusão permanente e irreversível</strong><p>O grupo <b>${escapeHtml(group.name)}</b> e todos os seus jogos, históricos, membros, avaliações, avisos e dados financeiros serão apagados definitivamente.</p></div></div><div class="field"><label>Digite EXCLUIR para confirmar</label><input name="confirmation" required autocomplete="off" autocapitalize="characters" placeholder="EXCLUIR"></div><button class="btn btn-danger btn-block" disabled id="confirmDeleteGroup">Excluir definitivamente</button></form>`, (root, close) => {
        const input = $('[name="confirmation"]', root);
        const button = $("#confirmDeleteGroup", root);
        input.addEventListener("input", () => { button.disabled = input.value.trim().toUpperCase() !== "EXCLUIR"; });
        $("#deleteGroupForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          button.disabled = true;
          button.textContent = "Excluindo...";
          await this.repo.deleteGroup(group.id, form.get("confirmation"));
          this.state = this.repo.state;
          localStorage.removeItem("tamoon-current-group");
          if (this.state.currentGroupId) localStorage.setItem("tamoon-current-group", this.state.currentGroupId);
          close();
          this.route = "home";
          this.render();
          this.toast("Grupo excluído permanentemente.");
        });
      });
    },

    openInviteModal() {
      const group = this.currentGroup();
      if (!group) return this.openGroupModal();
      const url = new URL(appBaseUrl());
      url.searchParams.set("invite", group.invite_code);
      const message = `⚽ Você foi convidado para o grupo ${group.name} no Tâmo On!\n\nCódigo de convite: ${group.invite_code}\n\nAcesse ${url.href}\nEntre com sua conta Google e informe o código para participar.`;
      this.modal("Convidar para o grupo", `<section class="invite-card">${this.groupAvatar(group, "invite-avatar")}<h3>${escapeHtml(group.name)}</h3><p>Compartilhe o código com quem participará da pelada.</p><div class="invite-code"><strong>${escapeHtml(group.invite_code)}</strong><button id="copyInviteCode" aria-label="Copiar código">⧉</button></div><button class="btn btn-whatsapp btn-block" id="shareWhatsApp">WhatsApp</button><button class="btn btn-secondary btn-block" id="nativeShare">Compartilhar convite</button></section>`, (root) => {
        $("#copyInviteCode", root).addEventListener("click", async () => {
          await navigator.clipboard.writeText(group.invite_code);
          this.toast("Código copiado.");
        });
        $("#shareWhatsApp", root).addEventListener("click", () => window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener"));
        $("#nativeShare", root).addEventListener("click", async () => {
          if (navigator.share) await navigator.share({ title: `Convite ${group.name}`, text: message, url: url.href });
          else {
            await navigator.clipboard.writeText(message);
            this.toast("Convite copiado.");
          }
        });
      });
    },

    openRoleManager() {
      if (!this.canManageGroup()) return this.toast("Somente o administrador pode gerenciar funções.", true);
      const group = this.currentGroup();
      this.modal("Gerenciar funções", `<div class="notice"><strong>Administrador único</strong><br>O administrador possui todos os privilégios do grupo. Ele pode delegar organizador, tesoureiro ou membro e transferir a administração para outro integrante.</div><div class="list">${this.state.members.map(member => {
        const player = this.memberPlayer(member) || { name: "Membro" };
        const isMe = member.user_id === this.state.profile.id;
        const isAdmin = ["admin", "owner"].includes(member.role);
        const normalizedRole = isAdmin ? "admin" : member.role;
        const canEditRole = !isMe && !isAdmin;
        const transferButton = !isMe && !isAdmin ? `<button class="transfer-button" data-transfer-admin="${member.user_id}" title="Transferir administração">♛</button>` : "";
        return `<div class="card role-row">${this.personAvatar(player)}<div class="list-main"><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(roleLabels[normalizedRole])}</small></div>${canEditRole ? `<select class="role-select" data-role-user="${member.user_id}">${["organizer", "treasurer", "member"].map(role => `<option value="${role}" ${role === normalizedRole ? "selected" : ""}>${roleLabels[role]}</option>`).join("")}</select>` : `<span class="role-pill ${roleClass(normalizedRole)}">${roleLabels[normalizedRole]}</span>`}${transferButton}</div>`;
      }).join("")}</div>`, (root, close) => {
        $$('[data-role-user]', root).forEach(select => select.addEventListener("change", async event => {
          event.currentTarget.disabled = true;
          await this.repo.setMemberRole(group.id, event.currentTarget.dataset.roleUser, event.currentTarget.value);
          this.state = this.repo.state;
          close();
          this.render();
          this.toast("Função atualizada.");
        }));
        $$('[data-transfer-admin]', root).forEach(button => button.addEventListener("click", async () => {
          const userId = button.dataset.transferAdmin;
          const player = this.memberPlayer(this.state.members.find(member => member.user_id === userId));
          if (!confirm(`Transferir a administração do grupo para ${player?.name || "este membro"}? Você passará a membro.`)) return;
          await this.repo.transferAdministration(group.id, userId);
          this.state = this.repo.state;
          close();
          this.render();
          this.toast("Administração transferida.");
        }));
      });
    },

    openMemberManager(userId) {
      if (!this.canManageMatches()) return this.toast("Somente administrador e organizador podem gerenciar integrantes.", true);
      const member = this.state.members.find(item => item.user_id === userId);
      if (!member) return this.toast("Membro não encontrado.", true);
      if (member.user_id === this.state.profile.id) return this.toast("Você não pode remover a si mesmo por esta opção.", true);
      if (["admin", "owner"].includes(member.role)) return this.toast("O administrador único não pode ser removido. Transfira a administração primeiro.", true);
      const player = this.memberPlayer(member) || { name: "Membro", primary_position: "Sem posição" };
      this.modal("Gerenciar membro", `<div class="member-manager-summary">${this.personAvatar(player)}<div><strong>${escapeHtml(player.name)}</strong><small>${playerPositionHtml(player)} · ${escapeHtml(roleLabels[member.role] || "Membro")}</small></div></div><div class="notice"><strong>Histórico preservado</strong><br>A remoção encerra imediatamente o acesso ao grupo e às notificações. Presenças, avaliações, pagamentos e registros anteriores permanecem no histórico.</div><button id="removeMemberButton" class="btn btn-danger btn-block">Remover do grupo</button>`, (root, close) => {
        $("#removeMemberButton", root)?.addEventListener("click", async event => {
          if (!confirm(`Remover ${player.name} deste grupo? O acesso será encerrado imediatamente.`)) return;
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = "Removendo…";
          try {
            await this.repo.removeGroupMember(this.state.currentGroupId, member.user_id);
            this.state = this.repo.state;
            await this.repo.logEvent("member_removed", { removed_user_id: member.user_id, removed_player_name: player.name });
            close();
            this.render();
            this.toast(`${player.name} foi removido do grupo.`);
          } catch (error) {
            button.disabled = false;
            button.textContent = "Remover do grupo";
            this.toast(error.message || "Não foi possível remover o membro.", true);
          }
        });
      });
    },

    openMemberRatings() {
      const me = this.myPlayer();
      const players = this.activePlayers().filter(player => player.id !== me?.id && player.user_id);
      if (!players.length) return this.toast("Ainda não há outros membros para avaliar.", true);
      this.modal("Avaliar membros", `<div class="notice"><strong>Avaliação confidencial</strong><br>Dê uma nota de 1 a 10 considerando o desempenho geral no futebol. Somente o administrador visualiza médias e quantidade de avaliações.</div><form id="memberRatingsForm" class="ratings-form">${players.map(player => {
        const existing = this.myRating(player.id);
        const value = existing?.score || 7;
        return `<div class="rating-input-row">${this.personAvatar(player)}<div class="rating-control"><div><strong>${escapeHtml(player.name)}</strong><span data-rating-value="${player.id}">${Number(value).toFixed(1)}</span></div><small>${playerPositionHtml(player)}</small><input type="range" min="1" max="10" step="0.5" value="${value}" name="rating_${player.id}" data-rating-slider="${player.id}"></div></div>`;
      }).join("")}<button class="btn btn-primary btn-block">Enviar avaliações</button></form>`, (root, close) => {
        $$('[data-rating-slider]', root).forEach(slider => slider.addEventListener("input", event => {
          $(`[data-rating-value="${event.currentTarget.dataset.ratingSlider}"]`, root).textContent = Number(event.currentTarget.value).toFixed(1);
        }));
        $("#memberRatingsForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const button = event.submitter;
          button.disabled = true;
          button.textContent = "Enviando...";
          const form = new FormData(event.currentTarget);
          for (const player of players) await this.repo.rateMember(this.state.currentGroupId, player.id, form.get(`rating_${player.id}`));
          await this.repo.loadGroup(this.state.currentGroupId, { subscribe: false });
          this.state = this.repo.state;
          close();
          this.render();
          this.toast("Avaliações salvas com confidencialidade.");
        });
      });
    },

    openProfileModal() {
      const profile = this.state.profile || {};
      const player = this.myPlayer();
      const photo = safeImageUrl(profile.avatar_url);
      this.modal("Meu perfil", `<div class="profile-summary">${photo ? `<img class="profile-photo" src="${escapeHtml(photo)}" alt="" referrerpolicy="no-referrer">` : `<div class="profile-photo profile-initials">${initials(profile.name)}</div>`}<div><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.email)}</small><span class="role-pill ${roleClass(this.currentRole())}">${roleLabels[this.currentRole()]}</span></div></div><form id="profileForm" class="form-grid"><div class="field"><label>Nome</label><input name="name" value="${escapeHtml(profile.name || "")}" required></div>${player ? `<div class="field"><label>Apelido no grupo</label><input name="nickname" value="${escapeHtml(player.nickname || "")}" placeholder="Como aparece na escalação"></div><div class="field-row"><div class="field"><label>Posição principal</label><select name="primary_position">${positionOptions.map(position => `<option ${position === player.primary_position ? "selected" : ""}>${position}</option>`).join("")}</select></div><div class="field"><label>Posição secundária</label><select name="secondary_position"><option value="">Nenhuma</option>${positionOptions.map(position => `<option ${position === player.secondary_position ? "selected" : ""}>${position}</option>`).join("")}</select></div></div><label class="check-row"><input name="goalkeeper" type="checkbox" ${player.goalkeeper ? "checked" : ""}> Também posso jogar no gol</label>` : ""}<button class="btn btn-primary btn-block">Salvar perfil</button></form><div class="account-separator"></div><button class="btn btn-danger btn-block" id="profileLogoutButton">Sair da conta</button>`, (root, close) => {
        $("#profileForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await this.repo.setProfile(form.get("name"));
          if (player) await this.repo.updateMyPlayer(this.state.currentGroupId, {
            nickname: form.get("nickname"),
            primaryPosition: form.get("primary_position"),
            secondaryPosition: form.get("secondary_position"),
            goalkeeper: form.get("goalkeeper") === "on"
          });
          this.state = this.repo.state;
          close();
          this.render();
          this.toast("Perfil atualizado.");
        });
        $("#profileLogoutButton", root).addEventListener("click", async () => { close(); await this.logout(); });
      });
    },

    openMatchForm() {
      if (!this.canManageMatches()) return this.toast("Seu perfil não pode criar jogos.", true);
      const date = new Date(Date.now() + 7 * 86400000);
      date.setHours(20, 0, 0, 0);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      this.modal("Agendar pelada", `<form id="matchForm" class="form-grid"><div class="field"><label>Título</label><input name="title" required value="Pelada semanal"></div><div class="field"><label>Data e hora da primeira pelada</label><input name="starts_at" type="datetime-local" min="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}" required value="${local}"></div><div class="field"><label>Local</label><input name="location" required placeholder="Arena e número da quadra"></div><div class="field-row"><div class="field"><label>Máximo de jogadores</label><input name="max_players" type="number" min="4" max="60" value="12" required></div><div class="field"><label>Jogadores por time <span class="optional-label">opcional</span></label><input name="players_per_team" type="number" min="2" max="11" placeholder="Definir depois"></div></div><div class="field-help">A quantidade de times será escolhida na aba Times. O número por time serve apenas como referência do evento.</div><label class="check-row recurrence-toggle"><input name="repeat_weekly" type="checkbox"> Repetir esta pelada toda semana</label><div class="recurrence-panel" id="recurrencePanel" hidden><div class="field"><label>Quantidade total de peladas</label><input name="occurrences" type="number" min="2" max="52" value="8" inputmode="numeric"><small>Será criada uma ocorrência a cada 7 dias, sempre no mesmo horário.</small></div><div class="recurrence-preview" id="recurrencePreview">8 peladas semanais serão agendadas.</div></div><div class="field"><label>Observações</label><textarea name="notes" placeholder="Uniforme, prazo, regras..."></textarea></div><button class="btn btn-primary btn-block">Criar programação</button></form>`, (root, close) => {
        const repeat = $('[name="repeat_weekly"]', root);
        const panel = $("#recurrencePanel", root);
        const occurrencesInput = $('[name="occurrences"]', root);
        const preview = $("#recurrencePreview", root);
        const refreshRecurrence = () => {
          panel.hidden = !repeat.checked;
          const count = Math.max(2, Math.min(52, Number(occurrencesInput.value || 8)));
          preview.textContent = `${count} peladas semanais serão agendadas.`;
        };
        repeat.addEventListener("change", refreshRecurrence);
        occurrencesInput.addEventListener("input", refreshRecurrence);
        refreshRecurrence();
        $("#matchForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const startsAt = new Date(form.get("starts_at"));
          if (startsAt <= new Date()) return this.toast("Escolha uma data futura.", true);
          const rawPlayersPerTeam = String(form.get("players_per_team") || "").trim();
          const playersPerTeam = rawPlayersPerTeam ? Number(rawPlayersPerTeam) : null;
          const occurrences = repeat.checked ? Math.max(2, Math.min(52, Number(form.get("occurrences") || 8))) : 1;
          const submit = event.submitter;
          submit.disabled = true;
          submit.textContent = occurrences > 1 ? "Criando série..." : "Criando...";
          const createdIds = await this.repo.createMatchSchedule({
            groupId: this.state.currentGroupId,
            title: form.get("title"),
            startsAt: startsAt.toISOString(),
            location: form.get("location"),
            maxPlayers: Number(form.get("max_players")),
            playersPerTeam,
            bbqEnabled: false,
            bbqPrice: 0,
            notes: form.get("notes") || "",
            occurrences
          });
          this.state = this.repo.state;
          close();
          this.render();
          let notificationText = "";
          try {
            const result = await this.repo.notifyMatchCreated(this.state.currentGroupId, createdIds?.[0]);
            notificationText = Number(result.sent || 0) > 0 ? ` Aviso enviado a ${result.sent} aparelho(s).` : " Nenhum aparelho vinculado recebeu push.";
          } catch (error) {
            console.warn("Pelada criada, mas a notificação falhou:", error);
            notificationText = " A pelada foi salva, mas o push não pôde ser enviado.";
          }
          this.toast((occurrences > 1 ? `${occurrences} peladas semanais agendadas.` : "Pelada agendada.") + notificationText);
        });
      });
    },

    openMatchDetails(id) {
      const match = this.state.matches.find(item => item.id === id);
      if (!match) return;
      const future = !this.isHistoricalMatch(match);
      const recurring = Number(match.recurrence_total || 1) > 1;
      const matchAttendance = this.attendanceFor(id);
      const grouped = { confirmed: [], waitlist: [], out: [] };
      matchAttendance.forEach(item => grouped[item.status]?.push(item));
      grouped.waitlist.sort((a, b) => Number(a.waitlist_position || 9999) - Number(b.waitlist_position || 9999));
      const attendanceByPlayer = new Map(matchAttendance.map(item => [item.player_id, item]));
      const pendingMembers = future
        ? this.state.members
            .map(member => ({ member, player: this.memberPlayer(member) }))
            .filter(item => item.player && item.player.active !== false && !this.isGuest(item.player))
            .filter(item => {
              const attendance = attendanceByPlayer.get(item.player.id);
              return !attendance || ["pending", "maybe"].includes(attendance.status);
            })
            .sort((a, b) => String(a.player.name || "").localeCompare(String(b.player.name || ""), "pt-BR"))
        : [];
      const confirmedCount = grouped.confirmed.length;
      const barbecueParticipants = this.attendanceFor(id).filter(item => item.bbq);
      const barbecueGuestsTotal = barbecueParticipants.reduce((sum, item) => sum + Number(item.bbq_guests || 0), 0);
      const barbecueTotal = barbecueParticipants.length + barbecueGuestsTotal;
      const barbecuePriceSummary = Number(match.bbq_price || 0) > 0 ? ` · ${money(match.bbq_price)} por pessoa` : "";
      const barbecueParticipantRows = barbecueParticipants
        .map(item => {
          const player = this.player(item.player_id) || { name: "Participante", primary_position: "" };
          const guests = Number(item.bbq_guests || 0);
          const details = [guests ? `${guests} acompanhante(s)` : "Sem acompanhantes", item.bbq_note ? `Levará: ${item.bbq_note}` : ""].filter(Boolean).join(" · ");
          return `<div class="bbq-participant-row">${this.personAvatar(player, "bbq-participant-avatar")}<div class="list-main"><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(details)}</small></div>${this.isGuest(player) ? '<span class="guest-badge">Convidado</span>' : ""}</div>`;
        })
        .join("");
      const barbecueParticipantsPanel = barbecueParticipants.length
        ? `<div class="bbq-participants-panel bbq-summary-card"><button type="button" class="bbq-participants-toggle" data-toggle-bbq-participants aria-expanded="false" aria-controls="bbqParticipants-${match.id}"><span class="bbq-summary-icon" aria-hidden="true">♨</span><span class="bbq-participants-summary"><strong>Churrasco confirmado</strong><small>${barbecueParticipants.length} participante(s)${barbecueGuestsTotal ? ` + ${barbecueGuestsTotal} acompanhante(s)` : ""} · ${barbecueTotal} pessoa(s) no total${barbecuePriceSummary}</small></span><span class="bbq-participants-action"><span class="bbq-participants-action-label">Ver nomes</span><b aria-hidden="true">⌄</b></span></button><div id="bbqParticipants-${match.id}" class="bbq-participants-list" data-bbq-participants-list hidden>${barbecueParticipantRows}</div></div>`
        : `<div class="bbq-participants-panel bbq-summary-card is-empty"><div class="bbq-participants-toggle is-static"><span class="bbq-summary-icon" aria-hidden="true">♨</span><span class="bbq-participants-summary"><strong>Churrasco confirmado</strong><small>Nenhum participante confirmou até o momento${barbecuePriceSummary}.</small></span></div></div>`;
      const attendanceRow = (item, key) => {
        const player = this.player(item.player_id) || { name: "Jogador" };
        const trailing = key === "waitlist" ? `<span class="waitlist-position">#${Number(item.waitlist_position || 0) || "–"}</span>` : "";
        const managerNote = item.status_change_source === "manager" ? '<small class="attendance-managed-note">ajustado pela organização</small>' : "";
        const bbqBadge = item.bbq ? '<span class="bbq-attendance-badge" title="Participará do churrasco" aria-label="Participará do churrasco">♨</span>' : "";
        const guestBadge = this.isGuest(player) ? '<span class="guest-badge">Convidado</span>' : "";
        return `<div class="card list-row attendance-list-row">${this.personAvatar(player)}<div class="list-main"><strong>${escapeHtml(player.name)}</strong><small>${playerPositionHtml(player)}</small>${managerNote}</div><div class="attendance-row-trailing">${bbqBadge}${guestBadge}${trailing}</div></div>`;
      };
      const groupHtml = (title, key) => `<div class="section-title"><h2>${title} (${grouped[key].length})</h2></div><div class="list">${grouped[key].map(item => attendanceRow(item, key)).join("") || '<div class="card empty">Nenhum.</div>'}</div>`;
      const pendingRow = ({ member, player }) => {
        const canSendReminder = future && this.canManageMatches() && Boolean(member?.user_id || player?.user_id);
        return `<div class="card list-row attendance-list-row pending-confirmation-row">${this.personAvatar(player)}<div class="list-main"><strong>${escapeHtml(player.name)}</strong><small>${playerPositionHtml(player)} · ainda não respondeu</small></div>${canSendReminder ? `<button type="button" class="attendance-reminder-button" data-remind-attendance="${match.id}" data-player-id="${player.id}" data-player-name="${escapeHtml(player.name)}" aria-label="Enviar lembrete de confirmação para ${escapeHtml(player.name)}"><span aria-hidden="true">🔔</span><b>Lembrar</b></button>` : '<span class="status-pill status-maybe">Pendente</span>'}</div>`;
      };
      const pendingHtml = future
        ? `<div class="section-title pending-confirmation-title"><h2>Pendente de confirmação (${pendingMembers.length})</h2><small>Sem resposta de presença ou ausência.</small></div><div class="list pending-confirmation-list">${pendingMembers.map(pendingRow).join("") || '<div class="card empty">Todos os membros já responderam.</div>'}</div>`
        : "";
      const recurringInfo = recurring ? `<div class="recurrence-detail"><span>↻</span><div><strong>Pelada semanal recorrente</strong><small>Esta data pertence a uma série criada automaticamente.</small></div></div>` : "";

      const drawStatus = match.waitlist_drawn_at
        ? `<div class="draw-status ready"><span>✓</span><div><strong>Sorteio realizado</strong><small>${grouped.waitlist.length} pessoa(s) na espera inicial. O resultado permanece salvo até um novo sorteio.</small></div></div>`
        : `<div class="draw-status"><span>⇅</span><div><strong>Nenhum sorteio realizado</strong><small>Selecione livremente os participantes e quantos começarão na espera.</small></div></div>`;
      const drawSection = future
        ? `<section class="match-draw-section"><div class="section-title"><h2>Sorteio da espera</h2><small>Independente do limite de participantes.</small></div>${drawStatus}${this.canManageMatches() ? `<div class="draw-management-actions"><button class="btn btn-secondary" data-open-waitlist-draw="${match.id}">${match.waitlist_drawn_at ? "Refazer sorteio" : "Configurar sorteio"}</button>${match.waitlist_drawn_at ? `<button class="btn btn-danger-outline" data-clear-waitlist-draw="${match.id}">Excluir sorteio</button>` : ""}</div>` : ""}</section>`
        : grouped.waitlist.length ? `<section class="match-draw-section"><div class="section-title"><h2>Resultado da espera</h2></div>${drawStatus}</section>` : "";

      const bbqExpanded = match.bbq_enabled
        ? `<section class="match-bbq-section is-enabled"><div class="section-title"><h2>Confraternização</h2><small>Configuração exclusiva desta pelada.</small></div>${barbecueParticipantsPanel}${future && this.canManageGroup() ? `<form id="matchBbqForm" class="match-bbq-form"><label class="check-row"><input name="bbq_enabled" type="checkbox" checked> Haverá churrasco nesta pelada</label><div class="bbq-expanded-options"><div class="field" id="matchBbqPriceField"><label>Valor por pessoa</label><input name="bbq_price" type="number" min="0" step="0.01" value="${Number(match.bbq_price || 0)}" inputmode="decimal"></div><button class="btn btn-secondary btn-block">Salvar churrasco</button></div></form>` : ""}</section>`
        : future && this.canManageGroup()
          ? `<section class="match-bbq-compact"><form id="matchBbqForm" class="match-bbq-form compact"><label class="check-row bbq-toggle-row"><input name="bbq_enabled" type="checkbox"> Haverá churrasco nesta pelada</label><div class="bbq-expanded-options" hidden><div class="bbq-status enabled"><span>♨</span><div><strong>Configurar churrasco</strong><small>Informe o valor e salve para abrir as opções aos participantes.</small></div></div><div class="field" id="matchBbqPriceField"><label>Valor por pessoa</label><input name="bbq_price" type="number" min="0" step="0.01" value="0" inputmode="decimal"></div><button class="btn btn-secondary btn-block">Salvar churrasco</button></div></form></section>`
          : "";

      const managerControls = future && this.canManageMatches()
        ? `<section class="attendance-manager-section"><div class="section-title"><h2>Gestão da escala</h2><small>${pendingMembers.length} sem resposta.</small></div><div class="attendance-manager-actions"><button class="btn btn-secondary" data-manage-attendance="${match.id}">Gerenciar presenças</button><button class="btn btn-secondary" data-edit-match="${match.id}">Editar evento</button></div></section>`
        : "";
      const deleteControls = future && this.canManageMatches() ? `<div class="delete-match-actions"><button class="btn btn-danger btn-block delete-match-button" data-delete-match="${match.id}">${recurring ? "Excluir somente esta data" : "Excluir jogo agendado"}</button>${recurring ? `<button class="btn btn-danger-outline btn-block" data-delete-series="${match.id}">Excluir esta e as próximas</button>` : ""}<p class="danger-help">A exclusão só é permitida antes do horário. Peladas realizadas permanecem no histórico.</p></div>` : "";
      const eventCapacity = `<div class="match-detail-capacity"><span>Máximo: <strong>${Number(match.max_players)}</strong></span><span>Por time: <strong>${match.players_per_team ? Number(match.players_per_team) : "não definido"}</strong></span>${match.team_count ? `<span>Times: <strong>${Number(match.team_count)}</strong></span>` : ""}</div>`;
      const hasSavedTeams = this.state.assignments.some(item => item.match_id === match.id);
      const canOpenTeams = future ? (this.canManageMatches() || hasSavedTeams) : hasSavedTeams;
      this.modal(match.title, `<div class="match-detail-banner"><span class="status-pill ${future ? "status-maybe" : "status-confirmed"}">${future ? "Agendado" : "Histórico"}</span><strong>${escapeHtml(shortDate(match.starts_at))}</strong><p>${escapeHtml(match.location)}</p>${eventCapacity}${match.notes ? `<small>${escapeHtml(match.notes)}</small>` : ""}</div>${recurringInfo}${managerControls}${drawSection}${bbqExpanded}<div class="actions">${future ? `<button class="btn btn-primary" data-modal-rsvp="${match.id}">Minha presença</button>` : ""}${canOpenTeams ? `<button class="btn btn-secondary" data-modal-teams="${match.id}">Abrir Times</button>` : ""}</div>${deleteControls}${groupHtml("Começam jogando", "confirmed")}${groupHtml("Não vão", "out")}${groupHtml("Espera inicial", "waitlist")}${pendingHtml}`, (root, close) => {
        $("[data-modal-rsvp]", root)?.addEventListener("click", () => {
          close();
          this.openRsvp(match.id);
        });
        $("[data-modal-teams]", root)?.addEventListener("click", () => { close(); this.openTeamsForMatch(match.id); });
        $("[data-edit-match]", root)?.addEventListener("click", () => { close(); this.openMatchEditForm(match.id); });
        $("[data-manage-attendance]", root)?.addEventListener("click", () => {
          close();
          this.openAttendanceManager(match.id);
        });
        $$('[data-remind-attendance]', root).forEach(button => {
          button.addEventListener("click", async () => {
            const playerId = String(button.dataset.playerId || "");
            const playerName = String(button.dataset.playerName || "membro");
            if (!playerId || button.disabled) return;
            if (!confirm(`Enviar uma notificação individual para ${playerName}, solicitando a confirmação de presença?`)) return;
            const originalHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = '<span aria-hidden="true">…</span><b>Enviando</b>';
            try {
              const result = await this.repo.notifyAttendanceReminder(this.state.currentGroupId, match.id, playerId);
              if (Number(result.sent || 0) > 0) {
                button.innerHTML = '<span aria-hidden="true">✓</span><b>Enviado</b>';
                this.toast(`Lembrete enviado para ${playerName}.`);
              } else {
                button.disabled = false;
                button.innerHTML = originalHtml;
                this.toast(`${playerName} ainda não possui notificações ativas em nenhum aparelho.`, true);
              }
            } catch (error) {
              button.disabled = false;
              button.innerHTML = originalHtml;
              this.toast(error?.message || "Não foi possível enviar o lembrete.", true);
            }
          });
        });
        $("[data-open-waitlist-draw]", root)?.addEventListener("click", () => {
          close();
          this.openWaitlistDraw(match.id);
        });
        $("[data-clear-waitlist-draw]", root)?.addEventListener("click", async () => {
          if (!confirm("Excluir o sorteio realizado? Os membros da espera inicial voltarão para Começam jogando e os times separados serão apagados.")) return;
          await this.repo.clearMatchWaitlistDraw(match.id);
          this.state = this.repo.state;
          close();
          this.render();
          this.openMatchDetails(match.id);
          this.toast("Sorteio excluído. A espera inicial foi desfeita.");
        });
        const bbqParticipantsToggle = $("[data-toggle-bbq-participants]", root);
        if (bbqParticipantsToggle) {
          const participantsList = $("[data-bbq-participants-list]", root);
          const actionLabel = $(".bbq-participants-action-label", bbqParticipantsToggle);
          bbqParticipantsToggle.addEventListener("click", () => {
            const expanded = bbqParticipantsToggle.getAttribute("aria-expanded") !== "true";
            bbqParticipantsToggle.setAttribute("aria-expanded", String(expanded));
            bbqParticipantsToggle.classList.toggle("is-open", expanded);
            if (participantsList) participantsList.hidden = !expanded;
            if (actionLabel) actionLabel.textContent = expanded ? "Ocultar nomes" : "Ver nomes";
          });
        }
        const bbqForm = $("#matchBbqForm", root);
        if (bbqForm) {
          const enabled = $('[name="bbq_enabled"]', bbqForm);
          const options = $(".bbq-expanded-options", bbqForm);
          const price = $('[name="bbq_price"]', bbqForm);
          const refreshBbq = () => {
            if (options) options.hidden = !enabled.checked;
            if (price) price.disabled = !enabled.checked;
          };
          enabled.addEventListener("change", refreshBbq);
          refreshBbq();
          bbqForm.addEventListener("submit", async event => {
            event.preventDefault();
            const submit = event.submitter;
            if (!submit || submit.disabled) return;
            submit.disabled = true;
            submit.textContent = "Salvando...";
            await this.repo.updateMatchBbq(match.id, enabled.checked, Number(price?.value || 0));
            this.state = this.repo.state;
            close();
            this.render();
            this.openMatchDetails(match.id);
            this.toast(enabled.checked ? "Churrasco ativado para esta pelada." : "Churrasco removido desta pelada.");
          });
        }
        $("[data-delete-match]", root)?.addEventListener("click", async () => {
          const message = recurring ? "Excluir somente esta ocorrência da pelada semanal? As demais datas serão mantidas." : "Excluir definitivamente este jogo agendado?";
          if (!confirm(message)) return;
          await this.repo.deleteMatch(match.id);
          this.state = this.repo.state;
          close();
          this.render();
          this.toast(recurring ? "Ocorrência excluída. As demais foram mantidas." : "Jogo excluído.");
        });
        $("[data-delete-series]", root)?.addEventListener("click", async () => {
          if (!confirm("Excluir esta ocorrência e todas as próximas desta série semanal? Peladas anteriores e já realizadas serão preservadas.")) return;
          await this.repo.deleteMatchSeries(match.id);
          this.state = this.repo.state;
          close();
          this.render();
          this.toast("Esta ocorrência e as próximas foram excluídas.");
        });
      });
      if (this.launchMatchId && history.replaceState) {
        this.launchMatchId = "";
        history.replaceState({}, document.title, appBaseUrl());
      }
    },

    openMatchEditForm(matchId) {
      if (!this.canManageMatches()) return this.toast("Somente administrador e organizador podem editar eventos.", true);
      const match = this.state.matches.find(item => item.id === matchId);
      if (!match) return this.toast("Evento não encontrado.", true);
      if (new Date(match.starts_at) <= new Date()) return this.toast("Eventos já iniciados permanecem no histórico e não podem ser editados.", true);
      const recurring = Number(match.recurrence_total || 1) > 1;
      this.modal("Editar evento", `<form id="matchEditForm" class="form-grid"><div class="notice"><strong>${escapeHtml(match.title)}</strong><br>${recurring ? "As alterações serão aplicadas somente a esta ocorrência da série." : "Altere os dados operacionais deste evento."}</div><div class="field-row"><div class="field"><label>Máximo de jogadores</label><input name="max_players" type="number" min="4" max="60" value="${Number(match.max_players)}" required></div><div class="field"><label>Jogadores por time <span class="optional-label">opcional</span></label><input name="players_per_team" type="number" min="2" max="11" value="${match.players_per_team == null ? "" : Number(match.players_per_team)}" placeholder="Não definido"></div></div><div class="field-help">A quantidade de times é definida separadamente na aba Times.</div><div class="field"><label>Observações</label><textarea name="notes" placeholder="Uniforme, prazo, regras...">${escapeHtml(match.notes || "")}</textarea></div><button class="btn btn-primary btn-block">Salvar alterações</button></form>`, (root, close) => {
        $("#matchEditForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const rawPlayersPerTeam = String(form.get("players_per_team") || "").trim();
          const submit = event.submitter;
          submit.disabled = true;
          submit.textContent = "Salvando...";
          await this.repo.updateMatchSettings(matchId, {
            maxPlayers: Number(form.get("max_players")),
            playersPerTeam: rawPlayersPerTeam ? Number(rawPlayersPerTeam) : null,
            notes: form.get("notes") || ""
          });
          this.state = this.repo.state;
          close();
          this.render();
          this.openMatchDetails(matchId);
          this.toast("Dados do evento atualizados.");
        });
      });
    },

    openTeamsForMatch(matchId) {
      const match = this.state.matches.find(item => item.id === matchId) || null;
      if (matchId) this.selectedTeamMatchId = matchId;
      this.selectedTeamMatchHistoryMode = this.isHistoricalMatch(match);
      this.route = "teams";
      this.render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    },

    openWaitlistDraw(matchId) {
      if (!this.canManageMatches()) return this.toast("Somente administrador e organizador podem realizar o sorteio.", true);
      const match = this.state.matches.find(item => item.id === matchId);
      if (!match || new Date(match.starts_at) <= new Date()) return this.toast("O sorteio está disponível apenas em eventos futuros.", true);
      const eligibleAttendance = this.attendanceFor(matchId).filter(item => ["confirmed", "waitlist"].includes(item.status));
      const eligiblePlayers = eligibleAttendance.map(item => this.player(item.player_id)).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
      if (eligiblePlayers.length < 2) return this.toast("São necessárias ao menos duas presenças confirmadas para realizar o sorteio.", true);
      const currentWaitlist = new Set(eligibleAttendance.filter(item => item.status === "waitlist").map(item => item.player_id));
      const rows = eligiblePlayers.map(player => `<label class="draw-player-row"><input type="checkbox" name="draw_player" value="${player.id}" checked><span class="draw-player-check">✓</span>${this.personAvatar(player, "draw-player-avatar")}<span class="list-main"><strong>${escapeHtml(player.name)}</strong><small>${playerPositionHtml(player)}${currentWaitlist.has(player.id) ? " · atualmente na espera" : ""}</small></span>${this.isGuest(player) ? '<span class="guest-badge">Convidado</span>' : ""}</label>`).join("");
      const initialCount = Math.max(1, Math.min(currentWaitlist.size || 1, eligiblePlayers.length - 1));
      this.modal("Sorteio da espera", `<form id="waitlistDrawForm" class="form-grid"><div class="notice"><strong>${escapeHtml(match.title)}</strong><br>Escolha exatamente quem participará do sorteio. O sorteio pode ser realizado mesmo sem exceder o limite da pelada.</div><div class="draw-selection-head"><strong>Participantes do sorteio</strong><button type="button" class="text-button" id="toggleDrawPlayers">Desmarcar todos</button></div><div class="draw-player-list">${rows}</div><div class="field"><label>Quantos começarão na espera</label><input type="number" name="waitlist_count" min="1" max="${eligiblePlayers.length - 1}" value="${initialCount}" required inputmode="numeric"><small id="drawCountHelp">Selecione ao menos 2 participantes.</small></div><div class="field"><label>Forma de exibição</label><div class="radio-grid draw-mode-grid"><label class="radio-card"><input type="radio" name="draw_mode" value="instant" checked>Instantâneo</label><label class="radio-card"><input type="radio" name="draw_mode" value="reveal">Revelação</label></div></div><button class="btn btn-primary btn-block">Realizar sorteio</button></form>`, (root, close) => {
        const form = $("#waitlistDrawForm", root);
        const checks = () => $$('input[name="draw_player"]', form);
        const countInput = $('[name="waitlist_count"]', form);
        const toggle = $("#toggleDrawPlayers", form);
        const updateLimits = () => {
          const selected = checks().filter(input => input.checked).length;
          countInput.max = String(Math.max(1, selected - 1));
          if (Number(countInput.value) > selected - 1) countInput.value = String(Math.max(1, selected - 1));
          countInput.disabled = selected < 2;
          $("#drawCountHelp", form).textContent = selected < 2 ? "Selecione ao menos 2 participantes." : `${selected} selecionado(s); até ${selected - 1} podem ir para a espera.`;
          toggle.textContent = selected ? "Desmarcar todos" : "Selecionar todos";
        };
        checks().forEach(input => input.addEventListener("change", updateLimits));
        toggle.addEventListener("click", () => {
          const shouldCheck = !checks().some(input => input.checked);
          checks().forEach(input => { input.checked = shouldCheck; });
          updateLimits();
        });
        updateLimits();
        form.addEventListener("submit", async event => {
          event.preventDefault();
          const selected = checks().filter(input => input.checked).map(input => input.value);
          const count = Number(countInput.value || 0);
          if (selected.length < 2) return this.toast("Selecione ao menos dois participantes.", true);
          if (count < 1 || count >= selected.length) return this.toast("A quantidade da espera deve ser menor que o total selecionado.", true);
          const mode = new FormData(form).get("draw_mode") || "instant";
          const submit = event.submitter;
          if (!submit || submit.disabled) return;
          submit.disabled = true;
          submit.textContent = "Sorteando...";
          try {
            const result = await this.repo.drawMatchWaitlist(matchId, selected, count);
            this.state = this.repo.state;
            close();
            this.render();
            const drawnIds = Array.isArray(result.waitlist_player_ids) ? result.waitlist_player_ids : [];
            if (!drawnIds.length) throw new Error("O sorteio não retornou participantes para a espera.");
            if (mode === "reveal") this.openWaitlistReveal(matchId, drawnIds);
            else {
              this.openMatchDetails(matchId);
              this.toast(`${Number(result.waitlist_count || count)} participante(s) sorteado(s) para a espera inicial.`);
            }
          } catch (error) {
            console.error("Falha ao realizar sorteio:", error);
            submit.disabled = false;
            submit.textContent = "Realizar sorteio";
            this.toast(error?.message || "Não foi possível realizar o sorteio.", true);
          }
        });
      });
    },

    openWaitlistReveal(matchId, playerIds) {
      const match = this.state.matches.find(item => item.id === matchId);
      const players = playerIds.map(id => this.player(id)).filter(Boolean);
      let index = 0;
      this.modal("Revelação do sorteio", `<div class="draw-reveal"><div class="draw-reveal-stage"><span class="draw-reveal-kicker">ESPERA INICIAL</span><div id="drawRevealCard" class="draw-reveal-card"><span>?</span><strong>Resultado oculto</strong><small>Toque para revelar o primeiro nome</small></div></div><div id="drawRevealProgress" class="draw-reveal-progress">0 de ${players.length} revelados</div><button class="btn btn-primary btn-block" id="revealNextDraw">Revelar próximo</button></div>`, (root, close) => {
        const card = $("#drawRevealCard", root);
        const button = $("#revealNextDraw", root);
        const progress = $("#drawRevealProgress", root);
        button.addEventListener("click", () => {
          if (index >= players.length) {
            close();
            this.openMatchDetails(matchId);
            return;
          }
          const player = players[index];
          index += 1;
          card.classList.remove("is-revealed");
          void card.offsetWidth;
          card.innerHTML = `${this.personAvatar(player, "draw-reveal-avatar")}<strong>${escapeHtml(player.name)}</strong><small>${index}º da espera inicial${this.isGuest(player) ? " · Convidado" : ""}</small>`;
          card.classList.add("is-revealed");
          progress.textContent = `${index} de ${players.length} revelados`;
          button.textContent = index >= players.length ? "Ver resultado completo" : "Revelar próximo";
        });
      });
    },

    openAttendanceManager(matchId) {
      if (!this.canManageMatches()) return this.toast("Somente administrador e organizador podem gerenciar presenças.", true);
      const match = this.state.matches.find(item => item.id === matchId);
      if (!match || new Date(match.starts_at) <= new Date()) return this.toast("As presenças de jogos do histórico não podem ser alteradas.", true);
      const attendance = new Map(this.attendanceFor(matchId).map(item => [item.player_id, item]));
      const players = this.matchPlayers(matchId).sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
      const rows = players.map(player => {
        const current = attendance.get(player.id);
        const status = current?.status || "pending";
        const waitLabel = `Espera${current?.waitlist_position ? ` #${current.waitlist_position}` : ""}`;
        return `<label class="attendance-manager-row">${this.personAvatar(player, "attendance-manager-avatar")}<span><strong>${escapeHtml(player.name)}</strong><small>${playerPositionHtml(player)}</small></span><select name="attendance_${player.id}" data-player-id="${player.id}" data-original-status="${status}" aria-label="Presença de ${escapeHtml(player.name)}"><option value="pending" ${status === "pending" ? "selected" : ""}>Sem resposta</option><option value="confirmed" ${status === "confirmed" ? "selected" : ""}>Confirmado</option><option value="maybe" ${status === "maybe" ? "selected" : ""}>Talvez</option><option value="out" ${status === "out" ? "selected" : ""}>Ausente</option>${status === "waitlist" ? `<option value="waitlist" selected disabled>${waitLabel}</option>` : ""}</select></label>`;
      }).join("");
      this.modal("Gerenciar presenças", `<form id="attendanceManagerForm" class="form-grid"><div class="notice"><strong>${escapeHtml(match.title)}</strong><br>Administrador e organizador podem registrar respostas recebidas fora do aplicativo. A espera inicial continua sendo definida pelo sorteio.</div><div class="attendance-manager-list">${rows}</div><button class="btn btn-primary btn-block">Salvar alterações</button></form>`, (root, close) => {
        $("#attendanceManagerForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const changes = $$('select[data-player-id]', event.currentTarget).map(select => ({
            playerId: select.dataset.playerId,
            status: select.value,
            originalStatus: select.dataset.originalStatus
          })).filter(item => item.status !== item.originalStatus && item.status !== "waitlist");
          if (!changes.length) return this.toast("Nenhuma presença foi alterada.");
          const submit = event.submitter;
          submit.disabled = true;
          submit.textContent = "Salvando...";
          await this.repo.manageAttendances(matchId, changes);
          this.state = this.repo.state;
          close();
          this.render();
          this.openMatchDetails(matchId);
          this.toast(`${changes.length} presença(s) atualizada(s).`);
        });
      });
    },

    async setHomeGameResponse(matchId, value) {
      const match = this.state.matches.find(item => item.id === matchId);
      if (!match) return this.toast("Evento não encontrado.", true);
      if (new Date(match.starts_at) <= new Date()) return this.toast("A confirmação está encerrada para jogos do histórico.", true);
      const player = this.myPlayer();
      if (!player) return this.toast("Seu perfil de jogador não foi encontrado.", true);
      const requestedStatus = value === "out" ? "out" : "confirmed";
      const current = this.attendanceFor(matchId).find(item => item.player_id === player.id) || null;
      const currentAnswer = ["confirmed", "waitlist"].includes(current?.status) ? "confirmed" : current?.status === "out" ? "out" : "";
      if (currentAnswer === requestedStatus) return this.toast(requestedStatus === "confirmed" ? "Sua presença já está marcada." : "Sua ausência já está marcada.");
      const result = await this.repo.setMyGameResponse(matchId, requestedStatus);
      this.state = this.repo.state;
      this.render();
      const effectiveStatus = result.status || requestedStatus;
      if (effectiveStatus === "confirmed" && !["confirmed", "waitlist"].includes(current?.status)) {
        try {
          await this.repo.notifyAttendanceConfirmed(this.state.currentGroupId, matchId, player.id);
        } catch (error) {
          console.warn("Presença confirmada, mas a notificação falhou:", error);
        }
      }
      if (effectiveStatus === "out" && current?.status === "confirmed") {
        try {
          await this.repo.notifyAttendanceDeclined(this.state.currentGroupId, matchId, player.id);
        } catch (error) {
          console.warn("Ausência registrada, mas a notificação de alteração falhou:", error);
        }
      }
      if (effectiveStatus === "waitlist") this.toast("Resposta registrada. Sua situação seguirá a regra de espera definida para o evento.");
      else this.toast(requestedStatus === "confirmed" ? "Presença confirmada." : "Ausência confirmada.");
    },

    async setHomeBbqResponse(matchId, value) {
      const match = this.state.matches.find(item => item.id === matchId);
      if (!match) return this.toast("Evento não encontrado.", true);
      if (!match.bbq_enabled) return this.toast("Este evento não possui churrasco configurado.", true);
      if (new Date(match.starts_at) <= new Date()) return this.toast("A confirmação do churrasco está encerrada.", true);
      const player = this.myPlayer();
      if (!player) return this.toast("Seu perfil de jogador não foi encontrado.", true);
      const attending = value === "yes";
      const current = this.attendanceFor(matchId).find(item => item.player_id === player.id) || null;
      if (current?.bbq_responded && Boolean(current.bbq) === attending) return this.toast(attending ? "Sua participação no churrasco já está marcada." : "Sua ausência no churrasco já está marcada.");
      await this.repo.setMyBbqResponse(matchId, attending);
      this.state = this.repo.state;
      this.render();
      this.toast(attending ? "Participação no churrasco confirmada." : "Ausência no churrasco confirmada.");
    },

    openRsvp(matchId) {
      const match = this.state.matches.find(item => item.id === matchId);
      if (!match) return this.toast("Crie um jogo primeiro.", true);
      if (new Date(match.starts_at) <= new Date()) return this.toast("A confirmação está encerrada para jogos do histórico.", true);
      const player = this.myPlayer();
      if (!player) return this.toast("Seu perfil de jogador não foi encontrado.", true);
      const current = this.attendanceFor(matchId).find(item => item.player_id === player.id) || {};
      const selectedStatus = ["confirmed", "waitlist"].includes(current.status) ? "confirmed" : current.status === "out" ? "out" : "";
      const waitlistNotice = current.status === "waitlist" ? `<div class="notice attendance-waitlist-notice"><strong>Você está na espera inicial</strong><br>Ao manter “Vou”, sua intenção de participar permanece registrada conforme a regra do evento.</div>` : "";
      const gameOptions = [["confirmed", "Vou"], ["out", "Não vou"]].map(([value, label]) => `<label class="radio-card response-radio-card"><input type="radio" name="status" value="${value}" required ${selectedStatus === value ? "checked" : ""}><span>${label}</span></label>`).join("");
      const bbqOptions = match.bbq_enabled ? `<div class="response-modal-section"><strong>Churrasco</strong><small>Esta resposta é independente da presença no jogo.</small><div class="radio-grid">${[["yes", "Vou"], ["no", "Não vou"]].map(([value, label]) => `<label class="radio-card response-radio-card"><input type="radio" name="bbq_status" value="${value}" ${current.bbq_responded && ((value === "yes") === Boolean(current.bbq)) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div></div>` : "";
      this.modal("Minhas respostas", `<form id="rsvpForm" class="form-grid"><div class="notice"><strong>${escapeHtml(match.title)}</strong><br>${escapeHtml(shortDate(match.starts_at))} · ${escapeHtml(match.location)}</div>${waitlistNotice}<div class="response-modal-section"><strong>Jogo</strong><small>Informe se participará desta partida.</small><div class="radio-grid">${gameOptions}</div></div>${bbqOptions}<button class="btn btn-primary btn-block">Salvar respostas</button></form>`, (root, close) => {
        $("#rsvpForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const requestedStatus = String(form.get("status") || "");
          const bbqStatus = String(form.get("bbq_status") || "");
          if (!["confirmed", "out"].includes(requestedStatus)) return this.toast("Escolha se você vai ou não vai participar do jogo.", true);
          const submit = event.submitter;
          submit.disabled = true;
          submit.textContent = "Salvando...";
          const result = await this.repo.setMyGameResponse(matchId, requestedStatus);
          if (match.bbq_enabled && ["yes", "no"].includes(bbqStatus)) await this.repo.setMyBbqResponse(matchId, bbqStatus === "yes");
          this.state = this.repo.state;
          close();
          this.render();
          const effectiveStatus = result.status || requestedStatus;
          if (effectiveStatus === "confirmed" && !["confirmed", "waitlist"].includes(current.status)) {
            try {
              await this.repo.notifyAttendanceConfirmed(this.state.currentGroupId, matchId, player.id);
            } catch (error) {
              console.warn("Presença confirmada, mas a notificação falhou:", error);
            }
          }
          if (effectiveStatus === "out" && current.status === "confirmed") {
            try {
              await this.repo.notifyAttendanceDeclined(this.state.currentGroupId, matchId, player.id);
            } catch (error) {
              console.warn("Ausência registrada, mas a notificação de alteração falhou:", error);
            }
          }
          this.toast(effectiveStatus === "waitlist" ? "Respostas atualizadas. Sua situação seguirá a regra de espera do evento." : "Respostas atualizadas.");
        });
      });
    },

    async drawTeams(matchId, teamCount) {
      if (!this.canManageMatches()) return this.toast("Seu perfil não pode formar os times.", true);
      const match = this.state.matches.find(item => item.id === matchId);
      const confirmedCount = this.confirmedFor(matchId).length;
      if (!match) return this.toast("Evento não encontrado.", true);
      if (this.isHistoricalMatch(match)) return this.toast("Times de eventos finalizados são somente para consulta.", true);
      if (confirmedCount > Number(match.max_players)) {
        this.openMatchDetails(matchId);
        return this.toast("Faça o sorteio da espera inicial antes de separar os times.", true);
      }
      const requestedTeams = Number(teamCount || match.team_count || 2);
      if (!Number.isInteger(requestedTeams) || requestedTeams < 2 || requestedTeams > 12) return this.toast("Escolha uma quantidade válida de times.", true);
      if (requestedTeams > confirmedCount) return this.toast("A quantidade de times não pode ser maior que a de jogadores confirmados.", true);
      await this.repo.balanceTeams(matchId, requestedTeams);
      this.state = this.repo.state;
      this.selectedTeamMatchId = matchId;
      this.selectedTeamMatchHistoryMode = false;
      this.route = "teams";
      this.render();
      this.toast(`${requestedTeams} times separados com prioridade para goleiros principais.`);
    },

    async undoTeamSeparation(matchId) {
      if (!this.canManageMatches()) return this.toast("Seu perfil não pode desfazer a separação dos times.", true);
      const match = this.state.matches.find(item => item.id === matchId);
      if (!match) return this.toast("Evento não encontrado.", true);
      if (this.isHistoricalMatch(match)) return this.toast("A separação de um evento finalizado não pode ser desfeita.", true);
      const assignments = this.state.assignments.filter(item => item.match_id === matchId);
      if (!assignments.length) return this.toast("Este evento não possui uma separação de times ativa.", true);
      const teamCount = new Set(assignments.map(item => item.team_name)).size;
      const playerCount = assignments.length;
      const confirmed = window.confirm(`Deseja desfazer a separação de ${teamCount} time(s) com ${playerCount} jogador(es)?

As confirmações, o sorteio da espera e a quantidade configurada de times serão preservados.`);
      if (!confirmed) return;
      const result = await this.repo.clearMatchTeams(matchId);
      this.state = this.repo.state;
      this.selectedTeamMatchId = matchId;
      this.selectedTeamMatchHistoryMode = false;
      this.route = "teams";
      this.render();
      const removed = Number(result.cleared_assignments || playerCount);
      this.toast(`Separação desfeita. ${removed} jogador(es) retornaram à lista de confirmados.`);
    },

    openFinanceForm() {
      if (!this.canManageFinance()) return this.toast("Somente administração e tesouraria podem alterar o caixa.", true);
      const players = this.activePlayers();
      this.modal("Novo lançamento", `<form id="financeForm" class="form-grid"><div class="field"><label>Tipo</label><select name="type"><option value="payment">Pagamento recebido</option><option value="expense">Despesa</option><option value="charge">Nova cobrança</option></select></div><div class="field"><label>Jogador</label><select name="player_id"><option value="">Não se aplica</option>${players.map(player => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("")}</select></div><div class="notice finance-payment-link" id="paymentChargeInfo" hidden></div><div class="field"><label>Descrição</label><input name="description" required placeholder="Mensalidade, quadra, bola..."></div><div class="field"><label>Valor</label><input name="amount" type="number" min="0.01" step="0.01" required></div><button class="btn btn-primary btn-block">Salvar lançamento</button></form>`, (root, close) => {
        const formElement = $("#financeForm", root);
        const typeInput = $('[name="type"]', formElement);
        const playerInput = $('[name="player_id"]', formElement);
        const amountInput = $('[name="amount"]', formElement);
        const chargeInfo = $("#paymentChargeInfo", formElement);
        const linkedCharge = playerId => {
          if (!playerId) return null;
          return this.state.charges
            .filter(item => item.player_id === playerId && !["paid", "cancelled"].includes(item.status))
            .map(charge => {
              const paidAmount = this.state.payments
                .filter(payment => payment.charge_id === charge.id)
                .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
              return { ...charge, paidAmount, remaining: Math.max(0, Number(charge.amount || 0) - paidAmount) };
            })
            .filter(charge => charge.remaining > 0)
            .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0] || null;
        };
        const refreshPaymentLink = () => {
          const isPayment = typeInput.value === "payment";
          const charge = isPayment ? linkedCharge(playerInput.value) : null;
          chargeInfo.hidden = !isPayment;
          amountInput.removeAttribute("max");
          if (!isPayment) return;
          if (!playerInput.value) {
            chargeInfo.innerHTML = "<strong>Pagamento sem participante</strong><br>Escolha um jogador para vincular automaticamente uma cobrança pendente.";
            return;
          }
          if (!charge) {
            chargeInfo.innerHTML = "<strong>Nenhuma cobrança pendente</strong><br>O pagamento será registrado sem vínculo com cobrança.";
            return;
          }
          amountInput.max = charge.remaining.toFixed(2);
          chargeInfo.innerHTML = `<strong>Cobrança vinculada: ${escapeHtml(charge.description)}</strong><br>Total: ${money(charge.amount)} · Já pago: ${money(charge.paidAmount)} · Saldo: ${money(charge.remaining)}`;
        };
        typeInput.addEventListener("change", refreshPaymentLink);
        playerInput.addEventListener("change", refreshPaymentLink);
        refreshPaymentLink();

        formElement.addEventListener("submit", async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const type = form.get("type");
          const playerId = form.get("player_id") || null;
          const amount = Number(form.get("amount"));
          const base = { id: uid(), group_id: this.state.currentGroupId, description: form.get("description"), amount, player_id: playerId };
          let successMessage = "Lançamento salvo.";
          if (type === "payment") {
            const charge = linkedCharge(playerId);
            if (charge && amount > charge.remaining + 0.000001) {
              return this.toast(`O valor excede o saldo restante de ${money(charge.remaining)}.`, true);
            }
            await this.repo.recordPayment({ ...base, paid_at: nowIso(), method: "manual" }, charge);
            if (charge) {
              const remainingAfter = Math.max(0, charge.remaining - amount);
              successMessage = remainingAfter > 0
                ? `Pagamento parcial registrado. Restam ${money(remainingAfter)}.`
                : "Pagamento registrado. Cobrança quitada.";
            } else {
              successMessage = "Pagamento registrado sem cobrança vinculada.";
            }
          } else if (type === "expense") {
            await this.repo.mutate("expenses", { ...base, occurred_at: nowIso(), category: "outros" });
            successMessage = "Despesa registrada.";
          } else {
            await this.repo.mutate("charges", { ...base, due_date: new Date().toISOString().slice(0, 10), status: "open" });
            if (playerId) {
              try {
                const pushResult = await this.repo.notifyChargeCreated(this.state.currentGroupId, base.id);
                successMessage = Number(pushResult?.sent || 0) > 0
                  ? "Cobrança criada e aviso enviado ao membro."
                  : "Cobrança criada. O membro ainda não possui push ativo neste aparelho.";
              } catch (pushError) {
                console.warn("Não foi possível enviar a notificação da cobrança.", pushError);
                successMessage = "Cobrança criada, mas a notificação não pôde ser enviada.";
              }
            } else {
              successMessage = "Cobrança criada sem membro vinculado.";
            }
          }
          this.state = this.repo.state;
          close();
          this.render();
          this.toast(successMessage);
        });
      });
    },

    openBatchChargeForm() {
      if (!this.canManageFinance()) return this.toast("Somente administrador e tesoureiro podem criar cobranças em lote.", true);
      const players = this.activePlayers()
        .filter(player => player.user_id)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
      if (!players.length) return this.toast("Não há membros ativos com acesso ao grupo.", true);

      const today = new Date().toISOString().slice(0, 10);
      const memberRows = players.map(player => `<label class="batch-member-row"><input class="batch-member-checkbox" type="checkbox" name="player_ids" value="${player.id}"><span class="batch-member-avatar">${this.personAvatar(player)}</span><span><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.nickname || player.primary_position || "Membro")}</small></span></label>`).join("");

      this.modal("Cobrança em lote", `<form id="batchChargeForm" class="batch-charge-layout"><div class="batch-charge-top"><button type="button" class="batch-info-button" id="batchChargeInfo" aria-label="Informações sobre cobrança em lote">!</button><div class="field"><label>Descrição</label><input name="description" required minlength="2" maxlength="200" placeholder="Ex.: Mensalidade de agosto"></div><div class="form-grid two-columns"><div class="field"><label>Valor por membro</label><input name="amount" type="number" min="0.01" step="0.01" required inputmode="decimal"></div><div class="field"><label>Vencimento</label><input name="due_date" type="date" value="${today}" required></div></div><div class="batch-selection-head"><div><strong>Selecionar membros</strong><small id="batchSelectedCount">0 selecionado(s)</small></div><div><button type="button" class="text-action" id="batchSelectAll">Selecionar todos</button><button type="button" class="text-action" id="batchClearAll">Limpar</button></div></div></div><div class="batch-member-list">${memberRows}</div><div class="batch-charge-footer"><strong id="batchFooterCount">0 membros selecionados</strong><button id="batchChargeSubmit" class="btn btn-primary btn-block" type="submit" disabled>Criar cobranças</button></div></form>`, (root, close) => {
        const form = $("#batchChargeForm", root);
        const checkboxes = $$(".batch-member-checkbox", root);
        const counter = $("#batchSelectedCount", root);
        const submit = $("#batchChargeSubmit", root);
        const footerCount = $("#batchFooterCount", root);
        $("#batchChargeInfo", root)?.addEventListener("click", () => alert("Será criada uma cobrança individual para cada membro selecionado, usando a mesma descrição, valor e vencimento. Cada notificação será enviada somente ao respectivo membro."));
        const updateSelection = () => {
          const selected = checkboxes.filter(item => item.checked).length;
          counter.textContent = `${selected} selecionado(s)`;
          footerCount.textContent = `${selected} membro${selected === 1 ? "" : "s"} selecionado${selected === 1 ? "" : "s"}`;
          submit.textContent = selected ? `Criar ${selected} cobrança${selected === 1 ? "" : "s"}` : "Criar cobranças";
          submit.disabled = selected === 0;
        };
        checkboxes.forEach(item => item.addEventListener("change", updateSelection));
        $("#batchSelectAll", root)?.addEventListener("click", () => { checkboxes.forEach(item => { item.checked = true; }); updateSelection(); });
        $("#batchClearAll", root)?.addEventListener("click", () => { checkboxes.forEach(item => { item.checked = false; }); updateSelection(); });

        form.addEventListener("submit", async event => {
          event.preventDefault();
          const data = new FormData(form);
          const playerIds = data.getAll("player_ids").map(String).filter(Boolean);
          const description = String(data.get("description") || "").trim();
          const amount = Number(data.get("amount"));
          const dueDate = String(data.get("due_date") || today);
          if (!playerIds.length) return this.toast("Selecione ao menos um membro.", true);
          if (description.length < 2) return this.toast("Informe uma descrição válida.", true);
          if (!Number.isFinite(amount) || amount <= 0) return this.toast("Informe um valor válido.", true);
          if (!confirm(`Criar ${playerIds.length} cobrança(s) de ${money(amount)} cada, com a descrição “${description}”?`)) return;

          submit.disabled = true;
          submit.textContent = "Criando cobranças…";
          try {
            const result = await this.repo.createBatchCharges(this.state.currentGroupId, playerIds, description, amount, dueDate);
            const charges = Array.isArray(result.charges) ? result.charges : [];
            let notifiedMembers = 0;
            let withoutPush = 0;
            let pushFailures = 0;

            submit.textContent = "Enviando avisos individuais…";
            for (const charge of charges) {
              try {
                const pushResult = await this.repo.notifyChargeCreated(this.state.currentGroupId, charge.id);
                if (Number(pushResult?.sent || 0) > 0) notifiedMembers += 1;
                else withoutPush += 1;
              } catch (pushError) {
                pushFailures += 1;
                console.warn("Falha no push individual da cobrança em lote.", { chargeId: charge.id, pushError });
              }
            }

            this.state = this.repo.state;
            close();
            this.render();
            const created = Number(result.created_count || charges.length || playerIds.length);
            const details = [`${created} cobrança(s) criada(s)`, `${notifiedMembers} membro(s) notificado(s)`];
            if (withoutPush) details.push(`${withoutPush} sem aparelho ativo`);
            if (pushFailures) details.push(`${pushFailures} falha(s) no envio`);
            this.toast(details.join(" · "), pushFailures > 0);
          } catch (error) {
            submit.disabled = false;
            submit.textContent = "Criar cobranças";
            this.toast(error.message || "Não foi possível criar as cobranças em lote.", true);
          }
        });
      });
    },

    openBatchPaymentForm() {
      if (!this.canManageFinance()) return this.toast("Somente administrador e tesoureiro podem baixar pagamentos em lote.", true);

      const paymentTotals = this.state.payments.reduce((totals, payment) => {
        if (!payment.charge_id) return totals;
        totals[payment.charge_id] = (totals[payment.charge_id] || 0) + Number(payment.amount || 0);
        return totals;
      }, {});
      const pendingCharges = this.state.charges
        .filter(charge => !["paid", "cancelled"].includes(charge.status) && charge.player_id)
        .map(charge => {
          const player = this.player(charge.player_id);
          const amount = Number(charge.amount || 0);
          const paidAmount = Number(paymentTotals[charge.id] || 0);
          return { ...charge, player, amount, paidAmount, remaining: Math.max(0, amount - paidAmount) };
        })
        .filter(charge => charge.player && charge.remaining > 0)
        .sort((a, b) => String(a.player.name || "").localeCompare(String(b.player.name || ""), "pt-BR") || String(a.due_date || "").localeCompare(String(b.due_date || "")));

      if (!pendingCharges.length) return this.toast("Não há pendências vinculadas a membros para baixar.");

      const today = new Date().toISOString().slice(0, 10);
      const chargeRows = pendingCharges.map(charge => {
        const dueDate = charge.due_date
          ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${charge.due_date}T12:00:00`))
          : "sem vencimento";
        const partialLabel = charge.paidAmount > 0 ? `Parcial: ${money(charge.paidAmount)} · ` : "";
        return `<label class="batch-member-row batch-payment-row"><input class="batch-payment-checkbox" type="checkbox" name="charge_ids" value="${charge.id}" data-amount="${charge.remaining}"><span class="batch-member-avatar">${this.personAvatar(charge.player)}</span><span><strong>${escapeHtml(charge.player.name)}</strong><small>${escapeHtml(charge.description)} · vence ${escapeHtml(dueDate)}</small><b class="batch-payment-balance">${partialLabel}Baixar ${money(charge.remaining)}</b></span></label>`;
      }).join("");

      this.modal("Pagamentos em lote", `<form id="batchPaymentForm" class="batch-charge-layout"><div class="batch-charge-top"><button type="button" class="batch-info-button" id="batchPaymentInfo" aria-label="Informações sobre pagamentos em lote">!</button><div class="field"><label>Identificação dos lançamentos</label><input name="description" required minlength="2" maxlength="200" value="Pagamento em lote"></div><div class="form-grid two-columns"><div class="field"><label>Forma de pagamento</label><select name="method"><option value="manual">Manual</option><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="transfer">Transferência</option><option value="card">Cartão</option></select></div><div class="field"><label>Data do pagamento</label><input name="paid_date" type="date" value="${today}" required></div></div><div class="batch-selection-head"><div><strong>Selecionar pendências</strong><small id="batchPaymentSelectedCount">0 selecionada(s)</small></div><div><button type="button" class="text-action" id="batchPaymentSelectAll">Selecionar todas</button><button type="button" class="text-action" id="batchPaymentClearAll">Limpar</button></div></div></div><div class="batch-member-list">${chargeRows}</div><div class="batch-charge-footer"><strong id="batchPaymentFooter">Nenhuma pendência selecionada</strong><button id="batchPaymentSubmit" class="btn btn-primary btn-block" type="submit" disabled>Baixar pagamentos</button></div></form>`, (root, close) => {
        const form = $("#batchPaymentForm", root);
        const checkboxes = $$(".batch-payment-checkbox", root);
        const counter = $("#batchPaymentSelectedCount", root);
        const footer = $("#batchPaymentFooter", root);
        const submit = $("#batchPaymentSubmit", root);

        $("#batchPaymentInfo", root)?.addEventListener("click", () => alert("Cada item representa uma pendência já criada. Ao confirmar, o aplicativo lançará o saldo restante como pagamento, vinculará a entrada à pendência e marcará todas as selecionadas como pagas. Se um item falhar, nenhuma baixa do lote será aplicada."));

        const updateSelection = () => {
          const selected = checkboxes.filter(item => item.checked);
          const total = selected.reduce((sum, item) => sum + Number(item.dataset.amount || 0), 0);
          const count = selected.length;
          counter.textContent = `${count} selecionada(s)`;
          footer.textContent = count ? `${count} pendência${count === 1 ? "" : "s"} · Total ${money(total)}` : "Nenhuma pendência selecionada";
          submit.textContent = count ? `Baixar ${count} pagamento${count === 1 ? "" : "s"}` : "Baixar pagamentos";
          submit.disabled = count === 0;
        };

        checkboxes.forEach(item => item.addEventListener("change", updateSelection));
        $("#batchPaymentSelectAll", root)?.addEventListener("click", () => { checkboxes.forEach(item => { item.checked = true; }); updateSelection(); });
        $("#batchPaymentClearAll", root)?.addEventListener("click", () => { checkboxes.forEach(item => { item.checked = false; }); updateSelection(); });

        form.addEventListener("submit", async event => {
          event.preventDefault();
          const data = new FormData(form);
          const chargeIds = data.getAll("charge_ids").map(String).filter(Boolean);
          const description = String(data.get("description") || "").trim();
          const method = String(data.get("method") || "manual");
          const paidDate = String(data.get("paid_date") || today);
          const selected = checkboxes.filter(item => item.checked);
          const selectedTotal = selected.reduce((sum, item) => sum + Number(item.dataset.amount || 0), 0);

          if (!chargeIds.length) return this.toast("Selecione ao menos uma pendência.", true);
          if (description.length < 2) return this.toast("Informe uma identificação válida.", true);
          if (!paidDate) return this.toast("Informe a data dos pagamentos.", true);
          if (!confirm(`Baixar ${chargeIds.length} pendência(s), totalizando ${money(selectedTotal)}?\n\nOs pagamentos serão vinculados e as pendências selecionadas serão marcadas como pagas.`)) return;

          const [year, month, day] = paidDate.split("-").map(Number);
          const paidAt = new Date();
          paidAt.setFullYear(year, month - 1, day);
          if (paidDate !== today) paidAt.setHours(12, 0, 0, 0);

          submit.disabled = true;
          submit.textContent = "Processando baixas…";
          try {
            const result = await this.repo.recordBatchPayments(this.state.currentGroupId, chargeIds, description, method, paidAt.toISOString());
            this.state = this.repo.state;
            close();
            this.render();
            const created = Number(result.created_count || chargeIds.length);
            const total = Number(result.total_amount || selectedTotal);
            this.toast(`${created} pagamento(s) lançado(s) · ${money(total)} baixado(s) com sucesso.`);
          } catch (error) {
            submit.disabled = false;
            updateSelection();
            this.toast(error.message || "Não foi possível baixar os pagamentos em lote.", true);
          }
        });
      });
    },

    async deleteFinanceEntry(entryType, entryId) {
      if (!this.canManageFinance()) return this.toast("Somente administrador e tesoureiro podem excluir lançamentos.", true);
      const labels = { payment: "pagamento", expense: "despesa", charge: "cobrança" };
      const label = labels[entryType] || "lançamento";
      const complement = entryType === "payment" ? " Se estiver vinculado a uma cobrança, o valor pago, o saldo e o status serão recalculados." : "";
      if (!confirm(`Excluir este ${label} definitivamente?${complement}`)) return;
      await this.repo.deleteFinanceEntry(this.state.currentGroupId, entryType, entryId);
      this.state = this.repo.state;
      this.render();
      this.toast(`${label.charAt(0).toUpperCase() + label.slice(1)} excluído(a).`);
    },

    openPlayers() {
      if (!this.canManageMatches()) return this.toast("Somente administrador e organizador podem gerenciar convidados.", true);
      const guests = this.guestPlayers().sort((a, b) => {
        const matchA = this.state.matches.find(item => item.id === a.guest_match_id);
        const matchB = this.state.matches.find(item => item.id === b.guest_match_id);
        return new Date(matchA?.starts_at || 0) - new Date(matchB?.starts_at || 0) || String(a.name).localeCompare(String(b.name), "pt-BR");
      });
      const rows = guests.map(player => {
        const match = this.state.matches.find(item => item.id === player.guest_match_id);
        const eventLabel = match ? `${match.title} · ${shortDate(match.starts_at)}` : "Evento indisponível";
        return `<button type="button" class="card list-row guest-manage-row" data-edit-guest="${player.id}">${this.personAvatar(player)}<div class="list-main"><strong>${escapeHtml(player.name)}</strong><small>${playerPositionHtml(player)} · ${escapeHtml(eventLabel)}</small></div><span class="guest-badge">Convidado</span><strong>›</strong></button>`;
      }).join("");
      this.modal("Convidados por evento", `<button class="btn btn-primary btn-block" id="addPlayer">+ Incluir convidado</button><div class="section-title"><h2>Convidados cadastrados</h2><small>Visíveis somente no evento escolhido.</small></div><div class="list">${rows || '<div class="card empty">Nenhum convidado cadastrado.</div>'}</div>`, root => {
        $("#addPlayer", root)?.addEventListener("click", event => {
          if (event.currentTarget.disabled) return;
          event.currentTarget.disabled = true;
          this.openPlayerForm();
        }, { once: true });
        $$('[data-edit-guest]', root).forEach(button => button.addEventListener("click", () => this.openPlayerForm(button.dataset.editGuest), { once: true }));
      });
    },

    openPlayerForm(playerId = null) {
      if (!this.canManageMatches()) return this.toast("Sem permissão para gerenciar convidados.", true);
      const player = playerId ? this.state.players.find(item => item.id === playerId && item.guest_match_id) : null;
      if (playerId && !player) return this.toast("Convidado não encontrado.", true);
      const futureMatches = this.state.matches
        .filter(match => new Date(match.starts_at) > new Date() && !["cancelled", "finished"].includes(match.status))
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
      if (!player && !futureMatches.length) return this.toast("Crie um evento futuro antes de incluir convidados.", true);
      const eventOptions = futureMatches.map(match => `<option value="${match.id}" ${player?.guest_match_id === match.id ? "selected" : ""}>${escapeHtml(match.title)} · ${escapeHtml(shortDate(match.starts_at))}</option>`).join("");
      const positionItems = positionOptions.map(position => `<option value="${position}" ${player?.primary_position === position ? "selected" : ""}>${position}</option>`).join("");
      const title = player ? "Editar convidado" : "Incluir convidado";
      this.modal(title, `<form id="playerForm" class="form-grid" novalidate><div class="field"><label>Evento</label><select name="match_id" required ${player ? "disabled" : ""}><option value="">Selecione o evento</option>${eventOptions}</select>${player ? `<input type="hidden" name="match_id" value="${player.guest_match_id}">` : ""}</div><div class="field"><label>Nome</label><input name="name" required minlength="2" maxlength="80" autocomplete="off" value="${escapeHtml(player?.name || "")}" placeholder="Ex.: João da Silva"><small>Letras, espaços, ponto, apóstrofo e hífen.</small></div><div class="field"><label>Apelido <span class="optional-label">opcional</span></label><input name="nickname" maxlength="40" autocomplete="off" value="${escapeHtml(player?.nickname || "")}" placeholder="Ex.: João"></div><div class="field"><label>Posição</label><select name="position" required><option value="">Selecione a posição</option>${positionItems}</select></div><label class="check-row"><input name="goalkeeper" type="checkbox" ${player?.goalkeeper ? "checked" : ""}> Também joga no gol</label><button class="btn btn-primary btn-block" type="submit">${player ? "Salvar alterações" : "Incluir convidado"}</button>${player ? '<button class="btn btn-danger-outline btn-block" type="button" id="deleteGuest">Excluir convidado</button>' : ""}</form>`, (root, close) => {
        const formEl = $("#playerForm", root);
        let submitting = false;
        formEl.addEventListener("submit", async event => {
          event.preventDefault();
          if (submitting) return;
          const form = new FormData(formEl);
          const name = String(form.get("name") || "").trim().replace(/\s+/g, " ");
          const nickname = String(form.get("nickname") || "").trim().replace(/\s+/g, " ");
          const position = String(form.get("position") || "");
          const matchId = String(form.get("match_id") || "");
          const validText = /^[\p{L}][\p{L}\p{M} .’'\-]{1,79}$/u;
          const validNickname = !nickname || /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .’'\-]{0,39}$/u.test(nickname);
          if (!matchId) return this.toast("Selecione o evento do convidado.", true);
          if (!validText.test(name)) return this.toast("Informe um nome válido usando letras, espaços, ponto, apóstrofo ou hífen.", true);
          if (!validNickname) return this.toast("O apelido contém caracteres não permitidos.", true);
          if (!positionOptions.includes(position)) return this.toast("Selecione a posição do convidado.", true);
          submitting = true;
          const submit = formEl.querySelector('button[type="submit"]');
          $$('button, input, select', formEl).forEach(control => control.disabled = true);
          submit.textContent = player ? "Salvando..." : "Incluindo...";
          try {
            const payload = { playerId: player?.id, matchId, name, nickname, position, goalkeeper: form.get("goalkeeper") === "on" || position === "Goleiro" };
            if (player) await this.repo.updateMatchGuest(payload); else await this.repo.createMatchGuest(payload);
            this.state = this.repo.state;
            close();
            this.render();
            this.toast(player ? "Dados do convidado atualizados." : "Convidado incluído no evento.");
          } catch (error) {
            submitting = false;
            $$('button, input, select', formEl).forEach(control => control.disabled = false);
            if (player) $('[name="match_id"]', formEl).disabled = true;
            submit.textContent = player ? "Salvar alterações" : "Incluir convidado";
            this.toast(error.message || "Não foi possível salvar o convidado.", true);
          }
        });
        $("#deleteGuest", root)?.addEventListener("click", async event => {
          if (submitting || !confirm(`Excluir ${player.name} deste evento?`)) return;
          submitting = true;
          event.currentTarget.disabled = true;
          event.currentTarget.textContent = "Excluindo...";
          try {
            await this.repo.deleteMatchGuest(player.id);
            this.state = this.repo.state;
            close();
            this.render();
            this.toast("Convidado excluído do evento.");
          } catch (error) {
            submitting = false;
            event.currentTarget.disabled = false;
            event.currentTarget.textContent = "Excluir convidado";
            this.toast(error.message || "Não foi possível excluir o convidado.", true);
          }
        }, { once: true });
      });
    },

    openProblemReport() {
      this.modal("Reportar problema", `<form id="problemForm" class="form-grid"><div class="notice"><strong>Beta fechado</strong><br>O relatório inclui automaticamente versão, aparelho, tela atual e estado das notificações. Não inclua senhas ou dados sensíveis.</div><div class="field"><label>Categoria</label><select name="category"><option value="erro">Erro ou função que não respondeu</option><option value="visual">Problema visual</option><option value="notificacao">Notificação</option><option value="sugestao">Sugestão de melhoria</option></select></div><div class="field"><label>Resumo</label><input name="title" maxlength="100" required placeholder="Ex.: não consegui confirmar presença"></div><div class="field"><label>O que aconteceu?</label><textarea name="description" maxlength="1500" required placeholder="Descreva os passos, o resultado esperado e o que apareceu na tela."></textarea></div><label class="check-row"><input type="checkbox" name="contact_ok" checked><span>O suporte pode entrar em contato pelo e-mail da minha conta.</span></label><button type="submit" class="btn btn-primary btn-block">Enviar relatório</button></form>`, (root, close) => {
        $("#problemForm", root).addEventListener("submit", async event => {
          event.preventDefault();
          const button = event.currentTarget.querySelector('button[type="submit"]');
          const form = new FormData(event.currentTarget);
          button.disabled = true; button.textContent = "Enviando…";
          try {
            await this.repo.reportProblem({ category: form.get("category"), title: form.get("title"), description: form.get("description"), contactOk: form.get("contact_ok") === "on" });
            close();
            this.toast("Relatório enviado. Obrigado por ajudar no beta.");
          } catch (error) {
            button.disabled = false; button.textContent = "Enviar relatório";
            this.toast(error.message || "Não foi possível enviar o relatório.", true);
          }
        });
      });
    },

    async openDiagnostics() {
      const online = navigator.onLine;
      const push = pushSupported() ? Notification.permission : "não suportado";
      const subscription = pushSupported() ? await this.currentPushSubscription().catch(() => null) : null;
      let dbStatus = "Disponível";
      try { await this.repo.session(); } catch { dbStatus = "Falha"; }
      const sync = this.lastSyncAt ? shortDate(this.lastSyncAt) : "Não registrada";
      const updateText = this.updateAvailable ? "Atualização pendente" : "Sem atualização detectada";
      this.modal("Sobre e diagnóstico", `<div class="diagnostic-grid"><div class="diagnostic-item ${online ? "ok" : "bad"}"><span></span><div><small>Internet</small><strong>${online ? "Conectado" : "Offline"}</strong></div></div><div class="diagnostic-item ${dbStatus === "Disponível" ? "ok" : "bad"}"><span></span><div><small>Banco e sessão</small><strong>${dbStatus}</strong></div></div><div class="diagnostic-item ${subscription ? "ok" : "warn"}"><span></span><div><small>Push deste aparelho</small><strong>${escapeHtml(subscription ? "Vinculado" : push)}</strong></div></div><div class="diagnostic-item ${this.updateAvailable ? "warn" : "ok"}"><span></span><div><small>Atualização</small><strong>${escapeHtml(updateText)}</strong></div></div></div><div class="system-info-card"><div><span>Aplicativo</span><strong>${APP_RELEASE.version}</strong></div><div><span>Build do aplicativo</span><strong>${APP_RELEASE.build}</strong></div><div><span>Build do HTML</span><strong>${this.htmlBuild() || "—"}</strong></div><div><span>Service worker</span><strong>${escapeHtml(String(window.tamoonPwa?.getState?.().swBuild || "verificando"))}</strong></div><div><span>Banco</span><strong>${APP_RELEASE.database}</strong></div><div><span>Última sincronização</span><strong>${escapeHtml(sync)}</strong></div><div><span>Modo</span><strong>${isStandalone() ? "Instalado" : "Navegador"}</strong></div><div><span>Dispositivo</span><strong>${escapeHtml(deviceLabel())}</strong></div></div><button class="btn btn-secondary btn-block" data-action="check-update">Verificar atualização</button><button class="btn btn-primary btn-block" data-action="report-problem">Reportar problema</button>`, () => {});
    },

    async openPlatformAdmin() {
      if (!this.state.is_platform_admin) return this.toast("Acesso restrito à administração da plataforma.", true);
      this.modal("Painel Beta", `<div class="admin-loading">Carregando indicadores, acessos e erros…</div>`, () => {});
      try {
        const data = await this.repo.platformDashboard();
        const s = data.summary || {};
        const security = data.security || {};
        const errorGroups = data.errorGroups || [];
        const accessList = data.accessList || [];
        const pushStatus = data.pushStatus || [];
        const pushReview = pushStatus.filter(item => String(item.health_status || "") !== "healthy");
        document.querySelector(".modal-layer")?.remove();

        const stat = (label, value, tone = "") => `<div class="admin-stat ${tone}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value ?? 0))}</strong></div>`;
        const statusLabel = status => ({ active: "Ativo", invited: "Convidado", blocked: "Bloqueado" }[status] || status);
        const accessRows = accessList.map((item, index) => {
          const status = item.status || "invited";
          const action = status === "blocked" ? "active" : "blocked";
          const actionLabel = status === "blocked" ? "Reativar" : "Bloquear";
          const lastSeen = item.last_seen_at ? shortDate(item.last_seen_at) : "Ainda não acessou";
          const isCurrentAdmin = String(item.email || "").toLowerCase() === String(this.state.profile?.email || "").toLowerCase();
          const actionButtons = isCurrentAdmin
            ? '<div class="beta-access-actions"><span class="access-self-label">Você</span></div>'
            : `<div class="beta-access-actions"><button type="button" class="access-action ${action === "blocked" ? "danger" : "restore"}" data-access-email="${escapeHtml(item.email)}" data-access-status="${action}">${actionLabel}</button><button type="button" class="access-action delete" data-delete-beta-index="${index}">Excluir permanentemente</button></div>`;
          return `<article class="beta-access-row"><div class="beta-access-main"><div><strong>${escapeHtml(item.user_name || item.email)}</strong><small>${escapeHtml(item.email)} · ${escapeHtml(lastSeen)}</small></div><span class="beta-access-status ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span></div><div class="beta-access-meta"><span>${Number(item.groups_count || 0)} grupo(s)</span>${item.notes ? `<span>${escapeHtml(item.notes)}</span>` : ""}</div>${actionButtons}</article>`;
        }).join("") || '<div class="card empty">Nenhum e-mail cadastrado.</div>';

        const pushRows = pushReview.map((item, index) => {
          const lastSeen = item.last_seen_at ? shortDate(item.last_seen_at) : "Ainda não acessou";
          const health = String(item.health_status || "unknown");
          const presentation = {
            no_device: ["🔕", "Sem push", "Nenhum aparelho ativo vinculado"],
            invalid: ["×", "Expirada", `${Number(item.invalid_push_devices || 0)} assinatura(s) invalidada(s)`],
            partial: ["◐", "Parcial", `${Number(item.healthy_push_devices || 0)} saudável(is) e ${Number(item.active_push_devices || 0) - Number(item.healthy_push_devices || 0)} em análise`],
            recovered: ["↻", "Recuperado", `${Number(item.recovered_30d || 0)} envio(s) recuperado(s) após repetição`],
            unstable: ["~", "Instável", "Uma falha final consecutiva; assinatura permanece ativa"],
            attention: ["!", "Atenção", "Duas falhas finais consecutivas"],
            reactivation: ["↻", "Reativar", "Três ou mais falhas finais consecutivas"],
            configuration_error: ["⚙", "Configuração", "Falha de autenticação com o serviço de push"],
            untested: ["?", "Não testada", `${Number(item.untested_push_devices || 0)} aparelho(s) sem entrega registrada`],
            unknown: ["?", "Indefinida", "Estado da assinatura não identificado"]
          }[health] || ["?", "Atenção", "Verificar métricas"];
          const lastFailure = item.last_failure_at
            ? `Última falha: ${shortDate(item.last_failure_at)}${item.last_failure_status ? ` · código ${item.last_failure_status}` : ""}`
            : presentation[2];
          const history = `${Number(item.notifications_30d || 0)} envio(s) · ${Number(item.technical_attempts_30d || 0)} tentativa(s) técnica(s)`;
          const outcomes = `${Number(item.recovered_30d || 0)} recuperado(s) · ${Number(item.final_failures_30d || 0)} falha(s) final(is)`;
          return `<article class="push-status-row push-health-${escapeHtml(health)}"><div class="push-status-main"><span class="push-status-icon">${presentation[0]}</span><div><strong>${escapeHtml(item.user_name || item.email)}</strong><small>${escapeHtml(item.email)} · ${escapeHtml(lastSeen)}</small></div><span class="push-status-badge">${escapeHtml(presentation[1])}</span></div><div class="push-status-meta"><span>${Number(item.active_push_devices || 0)} ativo(s) · ${Number(item.total_push_devices || 0)} total</span><span>${escapeHtml(lastFailure)}</span><span>${escapeHtml(history)}</span><span>${escapeHtml(outcomes)}</span></div>${item.last_failure_summary ? `<p class="push-health-reason">${escapeHtml(item.last_failure_summary)}</p>` : ""}<button type="button" class="btn btn-secondary btn-small" data-push-health-index="${index}">Ver tentativas</button></article>`;
        }).join("") || '<div class="card empty"><strong>Todos os usuários estão saudáveis</strong><span>As assinaturas ativas possuem entrega confirmada e nenhuma falha final consecutiva.</span></div>';

        const errorRows = errorGroups.map((item, index) => {
          const build = item.build ? `Build ${item.build}` : "Build não informada";
          const location = [item.source, item.line ? `linha ${item.line}` : ""].filter(Boolean).join(" · ");
          return `<article class="admin-error-group"><div class="admin-error-head"><span class="admin-error-count">${Number(item.occurrences || 0)}×</span><div><strong>${escapeHtml(item.message || "Erro sem mensagem")}</strong><small>${escapeHtml(item.event_type)} · ${escapeHtml(build)}${location ? ` · ${escapeHtml(location)}` : ""}</small></div></div><div class="admin-error-metrics"><span>${Number(item.affected_users || 0)} usuário(s)</span><span>Primeiro: ${escapeHtml(shortDate(item.first_seen))}</span><span>Último: ${escapeHtml(shortDate(item.last_seen))}</span></div><button type="button" class="btn btn-secondary btn-small" data-error-index="${index}">Ver ocorrências e metadados</button></article>`;
        }).join("") || '<div class="card empty">Nenhum erro registrado nas últimas 24 horas.</div>';

        const reports = (data.reports || []).map(item => `<details class="admin-feed-item"><summary><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(shortDate(item.created_at))}</small></div></summary><p>${escapeHtml(item.description)}</p><span>${escapeHtml(item.reporter_name || item.reporter_email || "Usuário")}${item.group_name ? ` · ${escapeHtml(item.group_name)}` : ""}</span><pre>${escapeHtml(JSON.stringify(item.context || {}, null, 2))}</pre></details>`).join("") || '<div class="card empty">Nenhum relato recebido.</div>';
        const logs = (data.logs || []).map(item => `<details class="admin-log-detail"><summary><span class="log-dot ${escapeHtml(item.severity)}"></span><div><strong>${escapeHtml(item.event_type)}</strong><small>${escapeHtml(shortDate(item.created_at))}${item.group_name ? ` · ${escapeHtml(item.group_name)}` : ""}</small></div></summary><pre>${escapeHtml(JSON.stringify(item.metadata || {}, null, 2))}</pre></details>`).join("") || '<div class="card empty">Nenhum log recente.</div>';

        const securityTone = Number(security.tables_without_rls || 0) || Number(security.auth_users_without_access || 0) ? "warn" : "ok";
        const systemStatus = Number(s.errors_24h || 0) ? "Sistema requer análise" : "Sistema operacional";
        const errorSubtitle = `${Number(s.errors_24h || 0)} registro(s) distribuído(s) em ${Number(s.error_groups_24h || 0)} erro(s) distinto(s)`;

        this.modal("Painel Beta", `<div class="health-strip ${Number(s.errors_24h || 0) ? "warn" : "ok"}"><span></span><div><strong>${systemStatus}</strong><small>${escapeHtml(errorSubtitle)}</small></div></div><div class="admin-toolbar"><button id="sendSystemNotification" class="btn btn-primary">Enviar notificação</button><button id="refreshPlatformPanel" class="btn btn-secondary">Atualizar painel</button></div><div class="admin-stats">${stat("Usuários", s.users_total)}${stat("Acessos ativos", s.beta_active)}${stat("Push ativo", s.push_users_active)}${stat("Push saudável", s.push_devices_healthy)}${stat("Instáveis", s.push_devices_unstable, Number(s.push_devices_unstable || 0) ? "warning" : "")}${stat("Atenção", s.push_devices_attention, Number(s.push_devices_attention || 0) ? "warning" : "")}${stat("Reativar", s.push_devices_reactivation, Number(s.push_devices_reactivation || 0) ? "danger" : "")}${stat("Configuração", s.push_devices_configuration_error, Number(s.push_devices_configuration_error || 0) ? "danger" : "")}${stat("Recuperados 30d", s.push_recovered_30d)}${stat("Falhas finais 30d", s.push_final_failures_30d, Number(s.push_final_failures_30d || 0) ? "danger" : "")}${stat("Tentativas técnicas", s.push_attempts_30d)}${stat("Assinaturas expiradas", s.push_devices_invalid, Number(s.push_devices_invalid || 0) ? "warning" : "")}${stat("Sem notificações", s.push_users_without_active, Number(s.push_users_without_active || 0) ? "warning" : "")}${stat("Convites pendentes", s.beta_invited, Number(s.beta_invited || 0) ? "warning" : "")}${stat("Bloqueados", s.beta_blocked, Number(s.beta_blocked || 0) ? "danger" : "")}${stat("Grupos", s.groups_total)}${stat("Peladas futuras", s.matches_upcoming)}${stat("Relatos abertos", s.feedback_open, Number(s.feedback_open || 0) ? "warning" : "")}${stat("Erros 24h", s.errors_24h, Number(s.errors_24h || 0) ? "danger" : "")}</div>

        <details class="admin-section-card" open><summary><div><strong>Acessos do beta</strong><small>Autorize, bloqueie ou exclua permanentemente.</small></div><span>${accessList.length}</span></summary><form id="betaAccessForm" class="beta-access-form"><div class="field"><label>E-mail da conta Google</label><input type="email" name="email" required autocomplete="off" placeholder="membro@gmail.com"></div><div class="field"><label>Observação <span class="optional-label">opcional</span></label><input name="notes" maxlength="500" placeholder="Grupo ou responsável pelo convite"></div><button type="submit" class="btn btn-primary btn-block">Autorizar e-mail</button></form><div class="beta-access-list">${accessRows}</div></details>

        <details class="admin-section-card" open><summary><div><strong>Saúde das notificações</strong><small>Estado atual, repetições automáticas, recuperações e falhas finais.</small></div><span class="push-summary-count ${pushReview.length ? "warn" : "ok"}">${pushReview.length}</span></summary><div class="push-status-summary"><strong>${Number(s.push_devices_healthy || 0)} aparelho(s) saudável(is)</strong><small>${Number(s.push_notifications_30d || 0)} envio(s) · ${Number(s.push_attempts_30d || 0)} tentativa(s) técnica(s) · ${Number(s.push_recovered_30d || 0)} recuperado(s) · ${Number(s.push_final_failures_30d || 0)} falha(s) final(is), nos últimos 30 dias.</small></div><div class="push-status-list">${pushRows}</div></details>

        <details class="admin-section-card" open><summary><div><strong>Erros agrupados — 24 horas</strong><small>Analise causas distintas, não apenas o contador bruto.</small></div><span>${errorGroups.length}</span></summary><div class="admin-error-list">${errorRows}</div></details>

        <details class="admin-section-card"><summary><div><strong>Segurança e integridade</strong><small>Verificações automáticas do banco.</small></div><span class="security-mini ${securityTone}">${securityTone === "ok" ? "OK" : "Atenção"}</span></summary><div class="security-grid">${stat("Tabelas sem RLS", security.tables_without_rls, Number(security.tables_without_rls || 0) ? "danger" : "")}${stat("Auth sem acesso", security.auth_users_without_access, Number(security.auth_users_without_access || 0) ? "danger" : "")}${stat("Vínculos bloqueados", security.blocked_group_memberships, Number(security.blocked_group_memberships || 0) ? "warning" : "")}${stat("Função do hook", security.hook_function_ready ? "Preparada" : "Ausente", security.hook_function_ready ? "" : "danger")}</div><div class="notice"><strong>Proteção de novos cadastros</strong><br>A função do hook foi instalada. Ative-a uma vez em Authentication → Hooks → Before User Created para impedir que contas não autorizadas sejam criadas.</div></details>

        <details class="admin-section-card"><summary><div><strong>Relatos recentes</strong><small>Descrição e contexto técnico completo.</small></div><span>${(data.reports || []).length}</span></summary><div class="admin-feed">${reports}</div></details>
        <details class="admin-section-card"><summary><div><strong>Logs recentes</strong><small>Abra cada registro para consultar os metadados.</small></div><span>${(data.logs || []).length}</span></summary><div class="admin-logs">${logs}</div></details>
        <button id="exportOperationalSnapshot" class="btn btn-secondary btn-block">Exportar dados operacionais — 30 dias</button>`, (root, close) => {
          $("#sendSystemNotification", root)?.addEventListener("click", () => this.openSystemNotificationForm());
          $("#refreshPlatformPanel", root)?.addEventListener("click", () => { close(); this.openPlatformAdmin(); });
          $("#betaAccessForm", root)?.addEventListener("submit", async event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const button = event.submitter;
            button.disabled = true;
            button.textContent = "Autorizando…";
            try {
              await this.repo.inviteBetaAccess(String(form.get("email") || ""), String(form.get("notes") || ""));
              close();
              this.toast("E-mail autorizado para o beta.");
              this.openPlatformAdmin();
            } catch (error) {
              button.disabled = false;
              button.textContent = "Autorizar e-mail";
              this.toast(error.message || "Não foi possível autorizar o e-mail.", true);
            }
          });
          $$('[data-access-email]', root).forEach(button => button.addEventListener("click", async event => {
            const target = event.currentTarget;
            const email = target.dataset.accessEmail;
            const status = target.dataset.accessStatus;
            const verb = status === "blocked" ? "bloquear" : "reativar";
            if (!confirm(`Deseja ${verb} o acesso de ${email}?`)) return;
            target.disabled = true;
            try {
              await this.repo.setBetaAccessStatus(email, status);
              close();
              this.toast(status === "blocked" ? "Acesso bloqueado imediatamente." : "Acesso reativado.");
              this.openPlatformAdmin();
            } catch (error) {
              target.disabled = false;
              this.toast(error.message || "Não foi possível alterar o acesso.", true);
            }
          }));
          $$('[data-delete-beta-index]', root).forEach(button => button.addEventListener("click", () => {
            const item = accessList[Number(button.dataset.deleteBetaIndex)];
            if (!item) return;
            close();
            setTimeout(() => this.openPermanentBetaUserDeletion(item), 0);
          }));
          $$('[data-error-index]', root).forEach(button => button.addEventListener("click", () => {
            const group = errorGroups[Number(button.dataset.errorIndex)];
            if (group) this.openPlatformErrorDetails(group);
          }));
          $$('[data-push-health-index]', root).forEach(button => button.addEventListener("click", () => {
            const item = pushReview[Number(button.dataset.pushHealthIndex)];
            if (!item) return;
            close();
            setTimeout(() => this.openPushDeliveryDetails(item), 0);
          }));
          $("#exportOperationalSnapshot", root)?.addEventListener("click", async event => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = "Preparando exportação…";
            try {
              const exported = await this.repo.platformOperationalExport(30, 5000);
              const blob = new Blob([JSON.stringify({ release: APP_RELEASE, ...exported }, null, 2)], { type: "application/json" });
              const link = document.createElement("a");
              link.href = URL.createObjectURL(blob);
              link.download = `tamo-on-beta-operacao-${new Date().toISOString().slice(0,10)}.json`;
              link.click();
              URL.revokeObjectURL(link.href);
              button.disabled = false;
              button.textContent = "Exportar dados operacionais — 30 dias";
            } catch (error) {
              button.disabled = false;
              button.textContent = "Exportar dados operacionais — 30 dias";
              this.toast(error.message || "Não foi possível exportar os dados.", true);
            }
          });
        });
      } catch (error) {
        document.querySelector(".modal-layer")?.remove();
        this.toast(error.message || "Não foi possível carregar o painel.", true);
      }
    },

    async openPushDeliveryDetails(item) {
      if (!this.state.is_platform_admin) return this.toast("Acesso restrito à administração da plataforma.", true);
      this.modal("Tentativas de notificação", `<div class="admin-loading">Carregando telemetria dos últimos 30 dias…</div>`, () => {});
      try {
        const rows = await this.repo.platformPushDeliveryAttempts(item.user_id, 30, 5000);
        document.querySelector(".modal-layer")?.remove();

        const deliveries = new Map();
        for (const row of rows) {
          const key = String(row.delivery_id || `${row.created_at}-${row.event_id || "push"}`);
          if (!deliveries.has(key)) deliveries.set(key, []);
          deliveries.get(key).push(row);
        }

        const grouped = [...deliveries.entries()].map(([deliveryId, deliveryRows]) => {
          deliveryRows.sort((a, b) => Number(a.attempt_number || 1) - Number(b.attempt_number || 1));
          const finalRow = [...deliveryRows].reverse().find(row => row.is_final) || deliveryRows[deliveryRows.length - 1];
          return { deliveryId, rows: deliveryRows, finalRow };
        }).sort((a, b) => new Date(b.finalRow?.created_at || 0) - new Date(a.finalRow?.created_at || 0));

        const acceptedCount = grouped.filter(group => group.finalRow?.status === "sent").length;
        const finalFailureCount = grouped.filter(group => group.finalRow?.status === "failed").length;
        const recoveredCount = grouped.filter(group => group.finalRow?.status === "sent" && Number(group.finalRow?.attempt_number || 1) > 1).length;
        const technicalFailures = rows.filter(row => row.status === "failed").length;

        const providerLabel = provider => ({ apple: "Apple Web Push", google: "Google Push", mozilla: "Mozilla Push", webpush: "Web Push" }[provider] || "Web Push");
        const categoryLabel = category => ({
          transport: "falha temporária de conexão",
          timeout: "tempo limite excedido",
          rate_limited: "limite temporário",
          provider_unavailable: "serviço indisponível",
          invalid_subscription: "assinatura expirada",
          authentication: "falha de autenticação",
          invalid_payload: "mensagem rejeitada",
          unknown: "falha não identificada"
        }[category] || "falha técnica");

        const deliveryCards = grouped.map(group => {
          const finalRow = group.finalRow || {};
          const sent = finalRow.status === "sent";
          const recovered = sent && Number(finalRow.attempt_number || 1) > 1;
          const totalDuration = group.rows.reduce((sum, row) => sum + Number(row.duration_ms || 0), 0);
          const code = finalRow.status_code ? ` · código ${finalRow.status_code}` : "";
          const context = [finalRow.group_name, finalRow.device_label, providerLabel(finalRow.provider), finalRow.event_type].filter(Boolean).join(" · ");
          const shortHash = finalRow.endpoint_hash ? `${String(finalRow.endpoint_hash).slice(0, 8)}…${String(finalRow.endpoint_hash).slice(-6)}` : "não disponível";
          const timeline = group.rows.map(row => {
            const attemptSent = row.status === "sent";
            const attemptCode = row.status_code ? ` · código ${row.status_code}` : "";
            const category = attemptSent ? "aceita" : categoryLabel(row.error_category);
            return `<div class="push-retry-step ${attemptSent ? "is-sent" : "is-failed"}"><span>${attemptSent ? "✓" : "!"}</span><div><strong>Tentativa ${Number(row.attempt_number || 1)}/${Number(row.max_attempts || 1)}</strong><small>${escapeHtml(category)}${escapeHtml(attemptCode)} · ${Number(row.duration_ms || 0)} ms${row.is_final ? " · resultado final" : " · nova tentativa agendada"}</small>${row.failure_summary ? `<p>${escapeHtml(row.failure_summary)}</p>` : ""}</div></div>`;
          }).join("");
          const title = recovered ? "Entregue após reenvio" : sent ? "Entregue ao serviço de push" : "Não entregue após as tentativas";
          return `<details class="push-delivery-group ${sent ? "is-sent" : "is-failed"}" ${grouped.length <= 3 ? "open" : ""}><summary><div class="push-attempt-head"><span>${sent ? "✓" : "!"}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(shortDate(finalRow.created_at))}${escapeHtml(code)} · ${group.rows.length} tentativa(s) · ${totalDuration} ms</small></div></div></summary><div class="push-attempt-meta">${escapeHtml(context || "Notificação")}${finalRow.event_id ? `<br><span>Referência: ${escapeHtml(finalRow.event_id)}</span>` : ""}<br><span>Dispositivo: ${escapeHtml(shortHash)}</span></div>${finalRow.failure_summary ? `<p class="push-delivery-summary">${escapeHtml(finalRow.failure_summary)}</p>` : ""}<div class="push-retry-timeline">${timeline}</div></details>`;
        }).join("") || '<div class="card empty"><strong>Nenhuma tentativa registrada</strong><span>O aparelho ainda não recebeu um envio desde a ativação das métricas detalhadas.</span></div>';

        const currentStatus = {
          healthy: "Saudável",
          recovered: "Saudável — último envio recuperado",
          partial: "Parcial",
          unstable: "Instável — uma falha final consecutiva",
          attention: "Atenção — duas falhas finais consecutivas",
          reactivation: "Reativação recomendada",
          configuration_error: "Falha de configuração",
          invalid: "Assinatura expirada",
          untested: "Ainda não testada",
          no_device: "Sem aparelho ativo"
        }[String(item.health_status || "")] || "Estado indefinido";
        const lastFailure = item.last_failure_at ? shortDate(item.last_failure_at) : "Nenhuma";

        this.modal("Tentativas de notificação", `<div class="push-detail-user"><strong>${escapeHtml(item.user_name || item.email)}</strong><small>${escapeHtml(item.email)} · ${escapeHtml(currentStatus)}</small></div><div class="admin-stats compact push-metrics-grid"><div class="admin-stat"><small>Envios</small><strong>${grouped.length}</strong></div><div class="admin-stat"><small>Aceitos</small><strong>${acceptedCount}</strong></div><div class="admin-stat ${finalFailureCount ? "danger" : ""}"><small>Falhas finais</small><strong>${finalFailureCount}</strong></div><div class="admin-stat"><small>Recuperados</small><strong>${recoveredCount}</strong></div><div class="admin-stat"><small>Tentativas técnicas</small><strong>${rows.length}</strong></div><div class="admin-stat ${technicalFailures ? "warning" : ""}"><small>Falhas técnicas</small><strong>${technicalFailures}</strong></div></div><div class="notice push-current-state"><strong>Última falha registrada</strong><br>${escapeHtml(lastFailure)}${item.last_failure_status ? ` · código ${escapeHtml(String(item.last_failure_status))}` : ""}${item.last_failure_summary ? `<br>${escapeHtml(item.last_failure_summary)}` : ""}<br><small>O endpoint completo e o endereço da infraestrutura não são exibidos. A identificação utiliza apenas hash sanitizado.</small></div><div class="push-attempt-list">${deliveryCards}</div><button type="button" class="btn btn-secondary btn-block" id="backToPlatformPanel">Voltar ao Painel Beta</button>`, (root, close) => {
          $("#backToPlatformPanel", root)?.addEventListener("click", () => { close(); this.openPlatformAdmin(); });
        });
      } catch (error) {
        document.querySelector(".modal-layer")?.remove();
        this.toast(error.message || "Não foi possível carregar as tentativas de push.", true);
      }
    },

    openPermanentBetaUserDeletion(item) {
      if (!this.state.is_platform_admin) return this.toast("Acesso restrito à administração da plataforma.", true);
      const email = String(item?.email || "").trim().toLowerCase();
      const displayName = item?.user_name || email;
      if (!email) return this.toast("Usuário inválido.", true);

      const accountText = item?.user_id
        ? "A conta será removida definitivamente do Supabase Auth. Os vínculos ativos, assinaturas push, avaliações feitas e dados pessoais do jogador serão removidos ou anonimizados."
        : "Este e-mail ainda não criou uma conta. A autorização pendente será removida definitivamente da lista do beta.";

      this.modal("Excluir membro do beta", `<form id="permanentBetaDeleteForm" class="form-grid"><div class="destructive-warning"><span>!</span><div><strong>Exclusão permanente e irreversível</strong><p>${escapeHtml(accountText)}</p></div></div><div class="permanent-delete-summary"><strong>${escapeHtml(displayName)}</strong><small>${escapeHtml(email)} · ${Number(item?.groups_count || 0)} grupo(s)</small></div>${item?.user_id ? '<div class="notice"><strong>Tratamento dos grupos</strong><br>A administração será transferida automaticamente quando houver outro integrante. Grupos sem nenhum outro membro serão excluídos. O histórico preservado será anonimizado como “Usuário excluído”.</div>' : ''}<div class="field"><label>Digite o e-mail completo para confirmar</label><input name="confirmation" type="email" required autocomplete="off" placeholder="${escapeHtml(email)}"></div><button class="btn btn-danger btn-block" id="confirmPermanentBetaDelete" disabled>Excluir permanentemente</button></form>`, (root, close) => {
        const form = $("#permanentBetaDeleteForm", root);
        const input = form.elements.confirmation;
        const button = $("#confirmPermanentBetaDelete", root);
        const validate = () => {
          button.disabled = String(input.value || "").trim().toLowerCase() !== email;
        };
        input.addEventListener("input", validate);
        form.addEventListener("submit", async event => {
          event.preventDefault();
          validate();
          if (button.disabled) return;
          button.disabled = true;
          button.textContent = "Excluindo…";
          try {
            const result = await this.repo.deleteBetaUserPermanently(email);
            close();
            if (result.invitationOnly) {
              this.toast("Autorização pendente removida permanentemente.");
            } else {
              const summary = result.summary || {};
              this.toast(`Usuário excluído permanentemente. ${Number(summary.groups_transferred || 0)} grupo(s) transferido(s) e ${Number(summary.groups_deleted || 0)} grupo(s) excluído(s).`);
            }
            this.openPlatformAdmin();
          } catch (error) {
            button.disabled = false;
            button.textContent = "Excluir permanentemente";
            this.toast(error.message || "Não foi possível excluir o usuário permanentemente.", true);
          }
        });
      });
    },

    async openPlatformErrorDetails(group) {
      if (!this.state.is_platform_admin) return;
      this.modal("Detalhes do erro", `<div class="admin-loading">Carregando ocorrências…</div>`, () => {});
      try {
        const rows = await this.repo.platformErrorDetails(group);
        document.querySelector(".modal-layer")?.remove();
        const details = rows.map(item => `<details class="error-occurrence"><summary><div><strong>${escapeHtml(item.user_name || item.user_email || "Usuário não identificado")}</strong><small>${escapeHtml(shortDate(item.created_at))}${item.group_name ? ` · ${escapeHtml(item.group_name)}` : ""}</small></div><span>Ver JSON</span></summary><pre>${escapeHtml(JSON.stringify(item.metadata || {}, null, 2))}</pre></details>`).join("") || '<div class="card empty">Nenhuma ocorrência encontrada.</div>';
        this.modal("Detalhes do erro", `<div class="error-detail-summary"><span>${Number(group.occurrences || 0)} ocorrência(s)</span><strong>${escapeHtml(group.message || "Erro sem mensagem")}</strong><small>${escapeHtml(group.event_type)}${group.build ? ` · Build ${escapeHtml(group.build)}` : ""}</small></div><div class="error-occurrence-list">${details}</div>`, () => {});
      } catch (error) {
        document.querySelector(".modal-layer")?.remove();
        this.toast(error.message || "Não foi possível carregar as ocorrências.", true);
      }
    },

    openAnnouncementCenter(selectedId = "") {
      const announcements = [...(this.state.announcements || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const canManage = this.canManageMatches();
      const list = announcements.length ? announcements.map(item => `<article class="announcement-card ${item.id === selectedId ? "is-selected" : ""}"><div class="announcement-icon">📣</div><div class="announcement-content"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(shortDate(item.created_at))}${item.push_sent_count || item.push_failed_count ? ` · ${Number(item.push_sent_count || 0)} enviado(s)` : ""}</small><p>${escapeHtml(item.body)}</p>${canManage ? `<div class="announcement-actions"><button class="announcement-action resend" data-resend-announcement="${item.id}">↻ Reenviar</button><button class="announcement-action delete" data-delete-announcement="${item.id}">Excluir</button></div>` : ""}</div></article>`).join("") : '<div class="card empty"><strong>Nenhum aviso publicado</strong><span>Os comunicados do grupo aparecerão aqui.</span></div>';
      this.modal("Avisos do grupo", `<div class="announcement-list">${list}</div>`, (root, close) => {
        if (selectedId) root.querySelector(".announcement-card.is-selected")?.scrollIntoView({ block: "center" });
        $$('[data-resend-announcement]', root).forEach(button => button.addEventListener("click", async event => {
          const target = event.currentTarget;
          target.disabled = true;
          target.textContent = "Reenviando…";
          try {
            const result = await this.repo.resendAnnouncement(this.state.currentGroupId, target.dataset.resendAnnouncement);
            this.state = this.repo.state;
            const sent = Number(result.sent || 0);
            const failed = Number(result.failed || 0);
            close();
            this.render();
            this.toast(sent ? `Aviso reenviado a ${sent} aparelho(s)${failed ? `; ${failed} falharam` : ""}.` : "Aviso mantido, mas nenhum aparelho recebeu o push.", !sent);
          } catch (error) {
            target.disabled = false;
            target.textContent = "↻ Reenviar";
            this.toast(error.message || "Não foi possível reenviar o aviso.", true);
          }
        }));
        $$('[data-delete-announcement]', root).forEach(button => button.addEventListener("click", async event => {
          if (!confirm("Excluir este aviso definitivamente? Ele será removido da Central de avisos, mas notificações já entregues não podem ser apagadas do celular.")) return;
          const target = event.currentTarget;
          target.disabled = true;
          try {
            await this.repo.deleteAnnouncement(target.dataset.deleteAnnouncement);
            this.state = this.repo.state;
            close();
            this.render();
            this.toast("Aviso excluído.");
          } catch (error) {
            target.disabled = false;
            this.toast(error.message || "Não foi possível excluir o aviso.", true);
          }
        }));
      });
      navigator.clearAppBadge?.().catch?.(() => {});
      if (this.launchAnnouncementId && history.replaceState) {
        this.launchAnnouncementId = "";
        history.replaceState({}, document.title, appBaseUrl());
      }
    },

    async currentPushSubscription() {
      if (!pushSupported()) return null;
      const registration = await this.ensureServiceWorker();
      return registration?.pushManager?.getSubscription() || null;
    },

    async enablePushNotifications() {
      if (!pushSupported()) throw new Error("Este navegador não oferece notificações push.");
      const publicKey = String(window.TAMOON_CONFIG?.vapidPublicKey || "").trim();
      if (!publicKey) throw new Error("A chave pública VAPID ainda não foi configurada.");
      if (isIos() && !isStandalone()) throw new Error("No iPhone, adicione o Tâmo On à Tela de Início e abra pelo ícone antes de ativar as notificações.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(permission === "denied" ? "As notificações foram bloqueadas nos ajustes do aparelho." : "A permissão para notificações não foi concedida.");
      const registration = await this.ensureServiceWorker();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey)
        });
      }
      await this.repo.savePushSubscription(subscription);
      this.state = this.repo.state;
      return subscription;
    },

    async disablePushNotifications(silent = false) {
      if (!pushSupported()) return;
      try {
        const subscription = await this.currentPushSubscription();
        if (!subscription) return;
        await this.repo.removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
        this.state = this.repo.state;
      } catch (error) {
        if (!silent) throw error;
        console.warn("Não foi possível remover a assinatura push durante a saída.", error);
      }
    },

    async maybeShowNotificationOnboarding() {
      const key = "tamoon-notification-onboarding-v2";
      if (localStorage.getItem(key) === "done") return;
      if (!pushSupported()) return;
      if (!String(window.TAMOON_CONFIG?.vapidPublicKey || "").trim()) return;
      if (Notification.permission === "denied") {
        localStorage.setItem(key, "done");
        return;
      }
      try {
        const subscription = await this.currentPushSubscription();
        const endpoint = subscription?.endpoint || "";
        const linked = Boolean(endpoint && (this.state.push_subscriptions || []).some(item => item.endpoint === endpoint && item.enabled));
        if (subscription && linked) {
          localStorage.setItem(key, "done");
          return;
        }
      } catch (error) {
        console.warn("Falha ao verificar o primeiro acesso às notificações.", error);
      }

      const overlay = document.createElement("div");
      overlay.className = "notification-onboarding-overlay";
      overlay.innerHTML = `<section class="notification-onboarding-card" role="dialog" aria-modal="true" aria-labelledby="notificationOnboardingTitle"><div class="notification-onboarding-icon">🔔</div><h2 id="notificationOnboardingTitle">Ative as notificações</h2><p>Receba avisos do grupo, novas peladas e confirmações de presença mesmo quando o Tâmo On estiver fechado.</p><button type="button" class="btn btn-primary btn-block" id="notificationOnboardingEnable">Ativar agora</button><button type="button" class="notification-onboarding-later" id="notificationOnboardingLater">Agora não</button><small>Você poderá alterar esta opção depois em Mais → Notificações no celular.</small></section>`;
      document.body.appendChild(overlay);
      const finish = () => {
        localStorage.setItem(key, "done");
        overlay.remove();
      };
      $("#notificationOnboardingLater", overlay)?.addEventListener("click", finish);
      $("#notificationOnboardingEnable", overlay)?.addEventListener("click", async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Ativando…";
        try {
          await this.enablePushNotifications();
          finish();
          this.toast("Notificações ativadas neste aparelho.");
        } catch (error) {
          button.disabled = false;
          button.textContent = "Ativar agora";
          this.toast(error.message || "Não foi possível ativar as notificações.", true);
        }
      });
    },

    openSystemNotificationForm() {
      if (!this.state.is_platform_admin) return this.toast("Acesso restrito à administração da plataforma.", true);
      this.modal("Notificação do sistema", `<form id="systemNotificationForm" class="form-grid"><div class="notice notice-success"><strong>Envio para toda a plataforma</strong><br>A notificação será enviada a todos os aparelhos ativos vinculados ao Tâmo On.</div><div class="field"><label>Título</label><input name="title" required maxlength="80" autocomplete="off" placeholder="Ex.: Atualização disponível"></div><div class="field"><label>Mensagem</label><textarea name="body" required maxlength="500" placeholder="Escreva a comunicação do sistema"></textarea></div><button id="publishSystemNotificationButton" type="submit" class="btn btn-primary btn-block">Enviar para todos</button></form>`, (root, close) => {
        const form = $("#systemNotificationForm", root);
        const button = $("#publishSystemNotificationButton", root);
        form?.addEventListener("submit", async event => {
          event.preventDefault();
          if (!button || button.disabled) return;
          const data = new FormData(event.currentTarget);
          const title = String(data.get("title") || "").trim();
          const body = String(data.get("body") || "").trim();
          if (title.length < 2 || body.length < 2) return this.toast("Informe um título e uma mensagem válidos.", true);
          if (!confirm("Enviar esta notificação para todos os usuários com aparelho vinculado?")) return;
          button.disabled = true;
          button.textContent = "Enviando…";
          try {
            const result = await this.repo.publishSystemNotification(title, body);
            close();
            const sent = Number(result.sent || 0);
            const failed = Number(result.failed || 0);
            this.toast(sent ? `Notificação enviada a ${sent} aparelho(s)${failed ? `; ${failed} falharam` : ""}.` : "Nenhum aparelho ativo recebeu a notificação.", !sent);
          } catch (error) {
            button.disabled = false;
            button.textContent = "Enviar para todos";
            this.toast(error.message || "Não foi possível enviar a notificação do sistema.", true);
          }
        });
      });
    },

    async openNotificationSettings() {
      const supported = pushSupported();
      const configured = Boolean(String(window.TAMOON_CONFIG?.vapidPublicKey || "").trim());
      const subscription = supported ? await this.currentPushSubscription() : null;
      const endpoint = subscription?.endpoint || "";
      const dbSubscription = endpoint ? (this.state.push_subscriptions || []).find(item => item.endpoint === endpoint) : null;
      const linked = Boolean(dbSubscription?.enabled);
      const permission = supported ? Notification.permission : "unsupported";
      const iosInstallRequired = isIos() && !isStandalone();
      const active = Boolean(subscription && linked);
      const failures = Number(dbSubscription?.consecutive_failures || 0);
      const lastFailure = dbSubscription?.last_failure_at ? shortDate(dbSubscription.last_failure_at) : "";
      const lastSuccess = dbSubscription?.last_success_at ? shortDate(dbSubscription.last_success_at) : "";
      const failureCode = Number(dbSubscription?.last_failure_status || 0);
      const failureReason = pushFailureSummary(failureCode, dbSubscription?.last_failure_reason || "", dbSubscription?.device_label || deviceLabel());

      let status = "Desativadas neste aparelho";
      let explanation = "Ative para receber avisos mesmo com o aplicativo fechado.";
      let tone = "";
      if (!supported) {
        status = "Não suportadas";
        explanation = "O navegador deste aparelho não oferece a tecnologia necessária.";
      } else if (!configured) {
        status = "Configuração pendente";
        explanation = "A chave pública VAPID precisa ser adicionada ao supabase-config.js.";
      } else if (iosInstallRequired) {
        status = "Instalação necessária";
        explanation = "No iPhone, notificações funcionam quando o site é adicionado à Tela de Início e aberto pelo ícone.";
      } else if (permission === "denied") {
        status = "Bloqueadas nos ajustes";
        explanation = "O navegador bloqueou as notificações. Libere a permissão nos ajustes do aparelho e vincule novamente.";
        tone = "is-warning";
      } else if (active && failures > 0) {
        status = "Ativas, com falha recente";
        explanation = `O aparelho permanece vinculado, mas houve ${failures} falha(s) consecutiva(s)${lastFailure ? `; última em ${lastFailure}` : ""}${failureCode ? `, código ${failureCode}` : ""}${failureReason ? `: ${failureReason}` : "."}`;
        tone = "is-warning";
      } else if (active && lastSuccess) {
        status = "Ativas e validadas";
        explanation = `Última entrega confirmada em ${lastSuccess}. Você pode enviar um novo teste a qualquer momento.`;
        tone = "is-active";
      } else if (active) {
        status = "Ativas, aguardando validação";
        explanation = "A assinatura está vinculada, mas ainda não existe uma entrega registrada. Use o teste abaixo.";
        tone = "is-warning";
      } else if (dbSubscription?.invalidated_at) {
        status = "Assinatura expirada";
        explanation = `${failureCode ? `O serviço respondeu com o código ${failureCode}. ` : ""}Vincule novamente para gerar uma assinatura válida neste aparelho.`;
        tone = "is-warning";
      } else if (subscription && !linked) {
        status = "Aguardando vinculação";
        explanation = "A permissão existe no aparelho, mas a assinatura não está ativa no banco. Toque em Vincular novamente.";
        tone = "is-warning";
      }

      const enableAction = `<button class="btn btn-primary btn-block" id="enablePush">${subscription ? "Vincular novamente" : "Ativar notificações"}</button>`;
      const activeActions = '<button class="btn btn-primary btn-block" id="testPush">Enviar notificação de teste</button><button class="btn btn-danger btn-block" id="disablePush">Desativar neste aparelho</button>';
      const actions = active ? activeActions : enableAction;
      this.modal("Notificações no celular", `<div class="notification-status-card ${tone}"><span>🔔</span><div><strong>${escapeHtml(status)}</strong><p>${escapeHtml(explanation)}</p></div></div>${configured && supported && !iosInstallRequired ? actions : ""}<div class="notice"><strong>Validação deste aparelho</strong><br>Cada tentativa de entrega passa a registrar sucesso, falha, código e horário para análise do beta. Nenhum conteúdo privado da notificação é exibido nas métricas.</div><div class="notice"><strong>Privacidade</strong><br>A ativação vale somente para este aparelho. Você pode desativar a qualquer momento.</div>`, (root, close) => {
        $("#enablePush", root)?.addEventListener("click", async event => {
          const button = event.currentTarget; button.disabled = true; button.textContent = "Ativando…";
          try { await this.enablePushNotifications(); close(); this.toast("Notificações ativadas e vinculadas neste aparelho."); }
          catch (error) { button.disabled = false; button.textContent = subscription ? "Vincular novamente" : "Ativar notificações"; this.toast(error.message, true); }
        });
        $("#testPush", root)?.addEventListener("click", async event => {
          const button = event.currentTarget; button.disabled = true; button.textContent = "Enviando teste…";
          try {
            const result = await this.repo.testPushNotification(this.state.currentGroupId, endpoint);
            await this.repo.loadGroup(this.state.currentGroupId, { subscribe: false });
            this.state = this.repo.state;
            if (Number(result.sent || 0) > 0) {
              close();
              this.toast("Notificação de teste enviada. Confirme o recebimento neste aparelho.");
            } else {
              button.disabled = false;
              button.textContent = "Enviar notificação de teste";
              const reason = String(result.failureReason || "").trim();
              this.toast(`O teste não foi entregue${result.failureStatus ? ` (código ${result.failureStatus})` : ""}${reason ? `: ${reason}` : "."}`, true);
            }
          } catch (error) {
            button.disabled = false;
            button.textContent = "Enviar notificação de teste";
            this.toast(error.message || "Não foi possível testar a notificação.", true);
          }
        });
        $("#disablePush", root)?.addEventListener("click", async event => {
          const button = event.currentTarget; button.disabled = true; button.textContent = "Desativando…";
          try { await this.disablePushNotifications(); close(); this.toast("Notificações desativadas neste aparelho."); }
          catch (error) { button.disabled = false; button.textContent = "Desativar neste aparelho"; this.toast(error.message, true); }
        });
      });
    },

    openAnnouncementForm() {
      if (!this.canManageMatches()) return this.toast("Sem permissão para publicar avisos.", true);
      this.modal("Publicar aviso", `<form id="noticeForm" class="form-grid"><div class="notice notice-success"><strong>Aviso com notificação</strong><br>O comunicado será salvo no grupo e enviado aos aparelhos que ativaram notificações.</div><div class="field"><label>Título</label><input name="title" required maxlength="80" autocomplete="off"></div><div class="field"><label>Mensagem</label><textarea name="body" required maxlength="500"></textarea></div><button id="publishNoticeButton" type="submit" class="btn btn-primary btn-block">Publicar e notificar</button></form>`, (root, close) => {
        const noticeForm = $("#noticeForm", root);
        const button = $("#publishNoticeButton", root);
        noticeForm?.addEventListener("submit", async event => {
          event.preventDefault();
          if (!button || button.disabled) return;

          const form = new FormData(event.currentTarget);
          const title = String(form.get("title") || "").trim();
          const body = String(form.get("body") || "").trim();
          if (title.length < 2 || body.length < 2) {
            this.toast("Informe um título e uma mensagem válidos.", true);
            return;
          }

          button.disabled = true;
          button.textContent = "Publicando…";
          try {
            const result = await this.repo.publishAnnouncement(this.state.currentGroupId, title, body);
            this.state = this.repo.state;
            close();
            this.render();
            const sent = Number(result.sent || 0);
            const failed = Number(result.failed || 0);
            const subscriptions = Number(result.subscriptions || 0);
            if (sent > 0) {
              this.toast(`Aviso publicado e enviado a ${sent} aparelho(s)${failed ? `; ${failed} envio(s) falharam` : ""}.`);
            } else if (subscriptions > 0 || failed > 0) {
              const reason = String(result.failureReason || "").trim();
              const status = Number(result.failureStatus || 0);
              this.toast(`Aviso publicado, mas o envio falhou em ${failed || subscriptions} aparelho(s)${status ? ` (código ${status})` : ""}${reason ? `: ${reason}` : "."}`, true);
            } else {
              this.toast("Aviso publicado. Nenhum integrante possui assinatura vinculada no banco.");
            }
          } catch (error) {
            button.disabled = false;
            button.textContent = "Publicar e notificar";
            console.error("Falha ao publicar aviso:", error);
            this.toast(error?.message || "Não foi possível publicar o aviso.", true);
          }
        });
      });
    },

    async logout() {
      if (!confirm("Deseja sair da sua conta neste aparelho?")) return;
      clearInterval(this.accessCheckTimer);
      await this.disablePushNotifications(true);
      await this.repo.signOut();
      localStorage.removeItem("tamoon-current-group");
      window.location.replace(appBaseUrl());
    },

    async exportData() {
      if (!this.state.is_platform_admin) return this.toast("A exportação integral é exclusiva da administração da plataforma.", true);
      const group = this.currentGroup();
      if (!group?.id) return this.toast("Selecione um grupo antes de exportar.", true);
      try {
        const exported = await this.repo.platformGroupExport(group.id);
        const blob = new Blob([JSON.stringify({ release: APP_RELEASE, currentGroupId: group.id, ...exported }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const safeName = String(group.name || "grupo").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "grupo";
        link.href = url;
        link.download = `tamo-on-backup-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        this.toast("Backup integral do grupo gerado.");
      } catch (error) {
        this.toast(error.message || "Não foi possível exportar o grupo.", true);
      }
    },

    toast(message, error = false) {
      let root = $("#toastRoot");
      if (!root) {
        root = document.createElement("div");
        root.id = "toastRoot";
        root.className = "toast-root";
        document.body.appendChild(root);
      }
      const toast = document.createElement("div");
      toast.className = `toast${error ? " error" : ""}`;
      toast.textContent = message;
      root.appendChild(toast);
      setTimeout(() => toast.remove(), 3600);
    }
  };

  window.App = App;

  async function boot() {
    const config = resolvePublicConfig();
    const cloudConfigured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
    if (cloudConfigured && !window.supabase) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Não foi possível carregar o cliente de nuvem."));
        document.head.appendChild(script);
      }).catch(error => {
        window.TAMOON_CLOUD_LOAD_ERROR = error;
      });
    }
    App.init();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
