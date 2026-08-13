import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { sendNotification } from "npm:web-push-neo@0.1.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
});

const cleanText = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

function keyFromEnvironment(mapName: string, legacyName: string): string {
  const legacy = String(Deno.env.get(legacyName) || "").trim();
  if (legacy) return legacy;
  const raw = String(Deno.env.get(mapName) || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const preferred = parsed.default;
    if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
    const first = Object.values(parsed).find((value) => typeof value === "string" && value.trim());
    return typeof first === "string" ? first.trim() : "";
  } catch {
    return "";
  }
}

function formatDateTime(value: string, timeZone: string) {
  const safeTimeZone = cleanText(timeZone, 80) || "America/Sao_Paulo";
  try {
    const date = new Date(value);
    return {
      date: new Intl.DateTimeFormat("pt-BR", { timeZone: safeTimeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(date),
      time: new Intl.DateTimeFormat("pt-BR", { timeZone: safeTimeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
    };
  } catch {
    const date = new Date(value);
    return {
      date: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date),
      time: new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
    };
  }
}

type StoredSubscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type PushFailure = { statusCode: number; reason: string };
type PushResult = {
  sent: number;
  failed: number;
  subscriptions: number;
  failureStatus: number;
  failureReason: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" }, 405);

  let stage = "startup";

  try {
    const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
    const publicKey = keyFromEnvironment("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = keyFromEnvironment("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = String(Deno.env.get("VAPID_PUBLIC_KEY") || "").trim();
    const vapidPrivateKey = String(Deno.env.get("VAPID_PRIVATE_KEY") || "").trim();
    const vapidSubject = String(Deno.env.get("VAPID_SUBJECT") || "").trim();

    if (!supabaseUrl || !publicKey || !secretKey) {
      return json({ error: "As credenciais internas do Supabase não estão disponíveis na Edge Function.", code: "SUPABASE_ENV_MISSING" }, 500);
    }
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      return json({ error: "As chaves VAPID da Edge Function ainda não foram configuradas.", code: "VAPID_ENV_MISSING" }, 503);
    }
    if (!/^(mailto:|https:\/\/)/i.test(vapidSubject)) {
      return json({ error: "VAPID_SUBJECT inválido. Use mailto:seu-email@dominio.com ou uma URL HTTPS.", code: "VAPID_SUBJECT_INVALID" }, 503);
    }

    const authorization = String(req.headers.get("Authorization") || "").trim();
    if (!authorization.startsWith("Bearer ")) return json({ error: "Sessão não informada.", code: "AUTH_HEADER_MISSING" }, 401);
    const accessToken = authorization.slice(7).trim();
    if (!accessToken) return json({ error: "Sessão inválida.", code: "AUTH_TOKEN_EMPTY" }, 401);

    stage = "authenticate-user";
    const userClient = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
    const user = userData.user;
    if (userError || !user) return json({ error: "Sessão inválida ou expirada.", code: "AUTH_INVALID" }, 401);

    stage = "authorize-beta-access";
    const userEmail = String(user.email || "").trim().toLowerCase();
    const { data: betaAccess, error: betaAccessError } = await adminClient
      .from("beta_access")
      .select("status,user_id")
      .eq("email", userEmail)
      .maybeSingle();
    if (betaAccessError) throw betaAccessError;
    if (!betaAccess || betaAccess.status !== "active" || (betaAccess.user_id && betaAccess.user_id !== user.id)) {
      return json({ error: "Acesso ao beta não autorizado ou bloqueado.", code: "BETA_ACCESS_REQUIRED" }, 403);
    }

    stage = "validate-input";
    const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanText(payload.action || "publish", 40).toLowerCase();
    const groupId = cleanText(payload.groupId, 64);
    let canManageMatches = false;
    let canManageFinance = false;
    let group: { id: string; name: string } | null = null;

    if (action !== "system-publish") {
      if (!groupId) return json({ error: "Grupo não informado.", code: "GROUP_REQUIRED" }, 400);
      stage = "authorize-member";
      const { data: membership, error: membershipError } = await adminClient
        .from("group_members")
        .select("role")
        .eq("group_id", groupId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return json({ error: "Você não participa deste grupo.", code: "NOT_GROUP_MEMBER" }, 403);
      const normalizedRole = cleanText(membership.role, 40).toLowerCase();
      canManageMatches = ["owner", "admin", "organizer"].includes(normalizedRole);
      canManageFinance = ["owner", "admin", "treasurer"].includes(normalizedRole);

      stage = "load-group";
      const { data, error: groupError } = await adminClient.from("groups").select("id,name").eq("id", groupId).single();
      if (groupError) throw groupError;
      group = data;
    }

    const appOrigin = String(Deno.env.get("APP_BASE_URL") || req.headers.get("Origin") || "").trim().replace(/\/+$/, "");


    const eventIdFromData = (data: Record<string, unknown>, fallback: string) => cleanText(
      data.announcementId || data.systemAnnouncementId || data.matchId || data.chargeId || data.playerId || fallback,
      160,
    );

    const providerFromEndpoint = (endpoint: string) => {
      const value = String(endpoint || "").toLowerCase();
      if (value.includes("web.push.apple.com")) return "apple";
      if (value.includes("fcm.googleapis.com") || value.includes("googleapis.com")) return "google";
      if (value.includes("mozilla.com")) return "mozilla";
      return "webpush";
    };

    const classifyPushError = (statusCode: number, reason: string) => {
      const value = String(reason || "").toLowerCase();
      if ([404, 410].includes(statusCode)) return "invalid_subscription";
      if ([401, 403].includes(statusCode)) return "authentication";
      if (statusCode === 400) return "invalid_payload";
      if (statusCode === 408 || value.includes("timeout") || value.includes("timed out")) return "timeout";
      if (statusCode === 429) return "rate_limited";
      if (statusCode >= 500) return "provider_unavailable";
      if (!statusCode || value.includes("error sending request") || value.includes("connection") || value.includes("network")) return "transport";
      return "unknown";
    };

    const publicPushFailure = (provider: string, statusCode: number, category: string) => {
      if (category === "invalid_subscription") return "Assinatura expirada, removida ou não reconhecida pelo serviço de push.";
      if (category === "authentication") return "Falha de autenticação entre a plataforma e o serviço de push.";
      if (category === "invalid_payload") return "Mensagem rejeitada pelo serviço de push.";
      if (category === "timeout") return "Tempo limite excedido ao conectar com o serviço de push.";
      if (category === "rate_limited") return "Limite temporário de solicitações do serviço de push.";
      if (category === "provider_unavailable") return "Serviço de push temporariamente indisponível.";
      if (category === "transport") {
        if (provider === "apple") return "Falha temporária ao conectar com o serviço Apple Web Push.";
        if (provider === "google") return "Falha temporária ao conectar com o serviço Google de notificações.";
        if (provider === "mozilla") return "Falha temporária ao conectar com o serviço Mozilla de notificações.";
        return "Falha temporária de conexão com o serviço de push.";
      }
      return statusCode ? `Falha no serviço de push. Código ${statusCode}.` : "Falha não identificada no serviço de push.";
    };

    const recordPushAttempt = async (options: {
      subscription: StoredSubscription;
      deliveryGroupId: string | null;
      eventType: string;
      eventId: string;
      deliveryId: string;
      attemptNumber: number;
      maxAttempts: number;
      isFinal: boolean;
      success: boolean;
      statusCode: number;
      technicalReason: string;
      durationMs: number;
      transient: boolean;
      category: string;
      provider: string;
    }) => {
      try {
        const { error } = await adminClient.rpc("record_push_delivery_attempt_v2", {
          p_subscription_id: options.subscription.id,
          p_group_id: options.deliveryGroupId || null,
          p_event_type: cleanText(options.eventType || "push", 80),
          p_event_id: cleanText(options.eventId, 160) || null,
          p_delivery_id: options.deliveryId,
          p_attempt_number: options.attemptNumber,
          p_max_attempts: options.maxAttempts,
          p_is_final: options.isFinal,
          p_success: options.success,
          p_status_code: options.statusCode || null,
          p_reason: cleanText(options.technicalReason, 1000) || null,
          p_duration_ms: Math.max(0, Math.min(Number(options.durationMs || 0), 120000)),
          p_transient: options.transient,
          p_error_category: cleanText(options.category, 80) || null,
          p_provider: cleanText(options.provider, 40) || null,
        });
        if (error) console.warn("Não foi possível registrar a tentativa técnica de push", error);
      } catch (trackingError) {
        console.warn("Falha ao persistir a telemetria do push", trackingError);
      }
    };

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const sendNotificationWithRetry = async (
      subscription: StoredSubscription,
      notificationPayload: string,
      tracking: { groupId: string | null; eventType: string; eventId: string },
    ) => {
      const maxAttempts = 3;
      const deliveryId = crypto.randomUUID();
      const provider = providerFromEndpoint(subscription.endpoint);

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const attemptStartedAt = Date.now();
        try {
          await sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, notificationPayload, {
            vapidDetails: { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey },
            TTL: 86400,
            urgency: "high",
            signal: AbortSignal.timeout(18000),
          });
          await recordPushAttempt({
            subscription,
            deliveryGroupId: tracking.groupId,
            eventType: tracking.eventType,
            eventId: tracking.eventId,
            deliveryId,
            attemptNumber: attempt,
            maxAttempts,
            isFinal: true,
            success: true,
            statusCode: 201,
            technicalReason: "",
            durationMs: Date.now() - attemptStartedAt,
            transient: false,
            category: "",
            provider,
          });
          return { attempts: attempt, deliveryId, recovered: attempt > 1 };
        } catch (error) {
          const pushError = error as { statusCode?: number; body?: string; message?: string };
          const statusCode = Number(pushError?.statusCode || 0);
          const technicalReason = String(pushError?.body || pushError?.message || "Falha no serviço de notificações.");
          const category = classifyPushError(statusCode, technicalReason);
          const transient = ["transport", "timeout", "rate_limited", "provider_unavailable"].includes(category);
          const isFinal = !transient || attempt >= maxAttempts;

          await recordPushAttempt({
            subscription,
            deliveryGroupId: tracking.groupId,
            eventType: tracking.eventType,
            eventId: tracking.eventId,
            deliveryId,
            attemptNumber: attempt,
            maxAttempts,
            isFinal,
            success: false,
            statusCode,
            technicalReason,
            durationMs: Date.now() - attemptStartedAt,
            transient,
            category,
            provider,
          });

          if (isFinal) {
            const wrapped = new Error(publicPushFailure(provider, statusCode, category)) as Error & {
              statusCode?: number;
              technicalReason?: string;
              category?: string;
              provider?: string;
            };
            wrapped.statusCode = statusCode;
            wrapped.technicalReason = technicalReason;
            wrapped.category = category;
            wrapped.provider = provider;
            throw wrapped;
          }

          await delay(350 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 180));
        }
      }

      throw new Error("Falha não identificada no serviço de push.");
    };

    const sendGroupPush = async (options: {
      title: string;
      body: string;
      tag: string;
      url: string;
      data: Record<string, unknown>;
      excludeUserId?: string;
    }): Promise<PushResult> => {
      stage = "load-recipients";
      const { data: members, error: membersError } = await adminClient.from("group_members").select("user_id").eq("group_id", groupId);
      if (membersError) throw membersError;
      const userIds = [...new Set((members || []).map((item) => item.user_id).filter(Boolean))]
        .filter((id) => id !== options.excludeUserId);

      let subscriptions: StoredSubscription[] = [];
      if (userIds.length) {
        const { data: activeRows, error: accessError } = await adminClient
          .from("beta_access")
          .select("user_id")
          .eq("status", "active")
          .in("user_id", userIds);
        if (accessError) throw accessError;
        const activeUserIds = [...new Set((activeRows || []).map((item) => item.user_id).filter(Boolean))];
        if (activeUserIds.length) {
          const { data, error } = await adminClient.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth").in("user_id", activeUserIds).eq("enabled", true);
          if (error) throw error;
          subscriptions = (data || []) as StoredSubscription[];
        }
      }

      let sent = 0;
      let failed = 0;
      const failures: PushFailure[] = [];
      const notificationPayload = JSON.stringify({
        title: options.title,
        body: options.body.slice(0, 240),
        icon: appOrigin ? `${appOrigin}/icons/icon-192-v023.png` : "/icons/icon-192-v023.png",
        badge: appOrigin ? `${appOrigin}/icons/icon-96.png` : "/icons/icon-96.png",
        tag: options.tag,
        timestamp: Date.now(),
        data: { ...options.data, url: options.url },
      });

      if (subscriptions.length) {
        stage = "send-push";
        await Promise.allSettled(subscriptions.map(async (subscription) => {
          try {
            await sendNotificationWithRetry(subscription, notificationPayload, {
              groupId,
              eventType: cleanText(options.data.eventType || "group-push", 80),
              eventId: eventIdFromData(options.data, options.tag),
            });
            sent += 1;
          } catch (error) {
            failed += 1;
            const pushError = error as { statusCode?: number; message?: string; technicalReason?: string; category?: string; provider?: string };
            const statusCode = Number(pushError?.statusCode || 0);
            const reason = cleanText(pushError?.message || "Falha no serviço de notificações.", 180);
            failures.push({ statusCode, reason });
            console.error("Falha ao enviar push", {
              statusCode,
              reason,
              category: pushError?.category || "unknown",
              provider: pushError?.provider || "webpush",
              technicalReason: cleanText(pushError?.technicalReason, 1000),
            });
          }
        }));
      }


      const firstFailure = failures[0] || null;
      return {
        sent,
        failed,
        subscriptions: subscriptions.length,
        failureStatus: firstFailure?.statusCode || 0,
        failureReason: firstFailure?.reason || "",
      };
    };

    const sendPushToUsers = async (targetUserIds: string[], options: {
      title: string;
      body: string;
      tag: string;
      url: string;
      data: Record<string, unknown>;
      endpoint?: string;
    }): Promise<PushResult> => {
      const userIds = [...new Set((targetUserIds || []).map((id) => cleanText(id, 64)).filter(Boolean))];
      let subscriptions: StoredSubscription[] = [];
      if (userIds.length) {
        stage = "load-direct-recipients";
        const { data: activeRows, error: accessError } = await adminClient
          .from("beta_access")
          .select("user_id")
          .eq("status", "active")
          .in("user_id", userIds);
        if (accessError) throw accessError;
        const activeUserIds = [...new Set((activeRows || []).map((item) => item.user_id).filter(Boolean))];
        if (activeUserIds.length) {
          const { data, error } = await adminClient.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth").in("user_id", activeUserIds).eq("enabled", true);
          if (error) throw error;
          subscriptions = (data || []) as StoredSubscription[];
          if (options.endpoint) subscriptions = subscriptions.filter((item) => item.endpoint === options.endpoint);
        }
      }

      let sent = 0;
      let failed = 0;
      const failures: PushFailure[] = [];
      const notificationPayload = JSON.stringify({
        title: options.title,
        body: options.body.slice(0, 240),
        icon: appOrigin ? `${appOrigin}/icons/icon-192-v023.png` : "/icons/icon-192-v023.png",
        badge: appOrigin ? `${appOrigin}/icons/icon-96.png` : "/icons/icon-96.png",
        tag: options.tag,
        timestamp: Date.now(),
        data: { ...options.data, url: options.url },
      });

      if (subscriptions.length) {
        stage = "send-direct-push";
        await Promise.allSettled(subscriptions.map(async (subscription) => {
          try {
            await sendNotificationWithRetry(subscription, notificationPayload, {
              groupId,
              eventType: cleanText(options.data.eventType || "direct-push", 80),
              eventId: eventIdFromData(options.data, options.tag),
            });
            sent += 1;
          } catch (error) {
            failed += 1;
            const pushError = error as { statusCode?: number; message?: string; technicalReason?: string; category?: string; provider?: string };
            const statusCode = Number(pushError?.statusCode || 0);
            const reason = cleanText(pushError?.message || "Falha no serviço de notificações.", 180);
            failures.push({ statusCode, reason });
            console.error("Falha ao enviar push direto", {
              statusCode,
              reason,
              category: pushError?.category || "unknown",
              provider: pushError?.provider || "webpush",
              technicalReason: cleanText(pushError?.technicalReason, 1000),
            });
          }
        }));
      }


      const firstFailure = failures[0] || null;
      return {
        sent,
        failed,
        subscriptions: subscriptions.length,
        failureStatus: firstFailure?.statusCode || 0,
        failureReason: firstFailure?.reason || "",
      };
    };

    const sendAllPush = async (options: {
      title: string;
      body: string;
      tag: string;
      url: string;
      data: Record<string, unknown>;
    }): Promise<PushResult> => {
      stage = "load-all-recipients";
      const { data: activeRows, error: activeError } = await adminClient.from("beta_access").select("user_id").eq("status", "active").not("user_id", "is", null);
      if (activeError) throw activeError;
      const activeUserIds = [...new Set((activeRows || []).map((item) => item.user_id).filter(Boolean))];
      let subscriptions: StoredSubscription[] = [];
      if (activeUserIds.length) {
        const { data, error } = await adminClient.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth").in("user_id", activeUserIds).eq("enabled", true);
        if (error) throw error;
        subscriptions = (data || []) as StoredSubscription[];
      }
      let sent = 0;
      let failed = 0;
      const failures: PushFailure[] = [];
      const notificationPayload = JSON.stringify({
        title: options.title,
        body: options.body.slice(0, 240),
        icon: appOrigin ? `${appOrigin}/icons/icon-192-v023.png` : "/icons/icon-192-v023.png",
        badge: appOrigin ? `${appOrigin}/icons/icon-96.png` : "/icons/icon-96.png",
        tag: options.tag,
        timestamp: Date.now(),
        data: { ...options.data, url: options.url },
      });
      stage = "send-system-push";
      await Promise.allSettled(subscriptions.map(async (subscription) => {
        try {
          await sendNotificationWithRetry(subscription, notificationPayload, {
            groupId: null,
            eventType: cleanText(options.data.eventType || "system-push", 80),
            eventId: eventIdFromData(options.data, options.tag),
          });
          sent += 1;
        } catch (error) {
          failed += 1;
          const pushError = error as { statusCode?: number; message?: string; technicalReason?: string; category?: string; provider?: string };
          const statusCode = Number(pushError?.statusCode || 0);
          const reason = cleanText(pushError?.message || "Falha no serviço de notificações.", 180);
          failures.push({ statusCode, reason });
          console.error("Falha ao enviar push do sistema", {
            statusCode,
            reason,
            category: pushError?.category || "unknown",
            provider: pushError?.provider || "webpush",
            technicalReason: cleanText(pushError?.technicalReason, 1000),
          });
        }
      }));
      const firstFailure = failures[0] || null;
      return { sent, failed, subscriptions: subscriptions.length, failureStatus: firstFailure?.statusCode || 0, failureReason: firstFailure?.reason || "" };
    };

    let announcement: Record<string, unknown> | null = null;
    let pushResult: PushResult;

    if (action === "test-push") {
      const endpoint = cleanText(payload.endpoint, 4000);
      if (!endpoint) return json({ error: "Assinatura deste aparelho não informada.", code: "ENDPOINT_REQUIRED" }, 400);
      const targetUrl = appOrigin
        ? `${appOrigin}/?group=${encodeURIComponent(groupId)}&page=more`
        : `/?group=${encodeURIComponent(groupId)}&page=more`;
      pushResult = await sendPushToUsers([user.id], {
        title: `${group!.name} · Teste de notificações`,
        body: "A notificação de teste foi entregue. Este aparelho está pronto para receber os avisos do grupo.",
        tag: `push-test-${user.id}-${Date.now()}`,
        url: targetUrl,
        endpoint,
        data: { groupId, eventType: "push-test", userId: user.id },
      });
      if (!pushResult.subscriptions) return json({ error: "A assinatura deste aparelho não está ativa no banco. Vincule novamente as notificações.", code: "SUBSCRIPTION_NOT_ACTIVE" }, 404);
      return json({ ...pushResult, action });
    }

    if (action === "system-publish") {
      stage = "authorize-platform-admin";
      const { data: platformAdmin, error: platformAdminError } = await adminClient.from("platform_admins").select("email").eq("email", userEmail).maybeSingle();
      if (platformAdminError) throw platformAdminError;
      if (!platformAdmin) return json({ error: "Acesso restrito à administração da plataforma.", code: "PLATFORM_ADMIN_REQUIRED" }, 403);
      const title = cleanText(payload.title, 80);
      const body = cleanText(payload.body, 500);
      if (title.length < 2 || body.length < 2) return json({ error: "Informe título e mensagem válidos.", code: "INVALID_INPUT" }, 400);
      stage = "create-system-announcement";
      const { data: systemAnnouncement, error: systemAnnouncementError } = await adminClient.from("system_announcements")
        .insert({ title, body, created_by: user.id })
        .select("id,title,body,created_at")
        .single();
      if (systemAnnouncementError) throw systemAnnouncementError;
      const targetUrl = appOrigin ? `${appOrigin}/?page=more` : "/?page=more";
      pushResult = await sendAllPush({
        title: `Tâmo On · ${title}`,
        body,
        tag: `system-${systemAnnouncement.id}`,
        url: targetUrl,
        data: { eventType: "system-announcement", systemAnnouncementId: systemAnnouncement.id },
      });
      await adminClient.from("system_announcements").update({ push_sent_at: new Date().toISOString(), push_sent_count: pushResult.sent, push_failed_count: pushResult.failed }).eq("id", systemAnnouncement.id);
      return json({ systemAnnouncement, ...pushResult, action });
    }

    if (action === "publish" || action === "resend") {
      if (!canManageMatches) return json({ error: "Somente administrador ou organizador pode gerenciar avisos.", code: "FORBIDDEN" }, 403);

      if (action === "publish") {
        const title = cleanText(payload.title, 80);
        const body = cleanText(payload.body, 500);
        if (title.length < 2 || body.length < 2) return json({ error: "Informe título e mensagem válidos.", code: "INVALID_INPUT" }, 400);
        stage = "create-announcement";
        const { data, error } = await adminClient.from("announcements")
          .insert({ group_id: groupId, title, body, created_by: user.id })
          .select("id,group_id,title,body,created_at,push_sent_count,push_failed_count")
          .single();
        if (error) throw error;
        announcement = data;
      } else {
        const announcementId = cleanText(payload.announcementId, 64);
        if (!announcementId) return json({ error: "Aviso não informado.", code: "ANNOUNCEMENT_REQUIRED" }, 400);
        stage = "load-announcement";
        const { data, error } = await adminClient.from("announcements")
          .select("id,group_id,title,body,created_at,push_sent_count,push_failed_count")
          .eq("id", announcementId).eq("group_id", groupId).single();
        if (error) throw error;
        announcement = data;
      }

      const targetUrl = appOrigin
        ? `${appOrigin}/?group=${encodeURIComponent(groupId)}&page=home&announcement=${encodeURIComponent(String(announcement.id))}`
        : `/?group=${encodeURIComponent(groupId)}&page=home&announcement=${encodeURIComponent(String(announcement.id))}`;
      pushResult = await sendGroupPush({
        title: `${group!.name} · Tâmo On`,
        body: `${announcement.title}: ${announcement.body}`,
        tag: `announcement-${announcement.id}`,
        url: targetUrl,
        data: { groupId, announcementId: announcement.id, eventType: action === "resend" ? "announcement-resend" : "announcement" },
      });

      stage = "update-announcement-metrics";
      const { error: metricsError } = await adminClient.from("announcements").update({
        push_sent_at: new Date().toISOString(),
        push_sent_count: pushResult.sent,
        push_failed_count: pushResult.failed,
      }).eq("id", announcement.id);
      if (metricsError) console.warn("Não foi possível atualizar as métricas do aviso", metricsError);
      return json({ announcement, ...pushResult, action });
    }

    if (action === "match-created") {
      if (!canManageMatches) return json({ error: "Somente administrador ou organizador pode notificar uma nova pelada.", code: "FORBIDDEN" }, 403);
      const matchId = cleanText(payload.matchId, 64);
      stage = "load-match";
      const { data: match, error } = await adminClient.from("matches")
        .select("id,group_id,title,starts_at,location,recurrence_total")
        .eq("id", matchId).eq("group_id", groupId).single();
      if (error) throw error;
      const when = formatDateTime(match.starts_at, cleanText(payload.timeZone, 80));
      const total = Number(match.recurrence_total || 1);
      const message = total > 1
        ? `Nova série com ${total} peladas: ${match.title}. A primeira será dia ${when.date}, às ${when.time}, em ${match.location}.`
        : `Nova pelada marcada: ${match.title}, dia ${when.date}, às ${when.time}, em ${match.location}.`;
      const targetUrl = appOrigin
        ? `${appOrigin}/?group=${encodeURIComponent(groupId)}&page=matches&match=${encodeURIComponent(match.id)}`
        : `/?group=${encodeURIComponent(groupId)}&page=matches&match=${encodeURIComponent(match.id)}`;
      pushResult = await sendGroupPush({
        title: `${group!.name} · Nova pelada`,
        body: message,
        tag: `match-created-${match.id}`,
        url: targetUrl,
        data: { groupId, matchId: match.id, eventType: "match-created" },
      });
      return json({ match, ...pushResult, action });
    }

    if (action === "attendance-confirmed") {
      const matchId = cleanText(payload.matchId, 64);
      const playerId = cleanText(payload.playerId, 64);
      stage = "load-attendance";
      const { data: attendance, error: attendanceError } = await adminClient.from("match_attendance")
        .select("id,status,player_id")
        .eq("group_id", groupId).eq("match_id", matchId).eq("player_id", playerId).maybeSingle();
      if (attendanceError) throw attendanceError;
      if (!attendance || attendance.status !== "confirmed") return json({ error: "A presença ainda não está confirmada.", code: "ATTENDANCE_NOT_CONFIRMED" }, 409);

      const [{ data: player, error: playerError }, { data: match, error: matchError }] = await Promise.all([
        adminClient.from("players").select("id,user_id,name,nickname").eq("id", playerId).eq("group_id", groupId).single(),
        adminClient.from("matches").select("id,group_id,title,starts_at").eq("id", matchId).eq("group_id", groupId).single(),
      ]);
      if (playerError) throw playerError;
      if (matchError) throw matchError;
      if (player.user_id !== user.id && !canManageMatches) return json({ error: "Você não pode notificar a presença deste jogador.", code: "FORBIDDEN" }, 403);

      const when = formatDateTime(match.starts_at, cleanText(payload.timeZone, 80));
      const displayName = cleanText(player.nickname || player.name || "Um jogador", 80);
      const targetUrl = appOrigin
        ? `${appOrigin}/?group=${encodeURIComponent(groupId)}&page=matches&match=${encodeURIComponent(match.id)}`
        : `/?group=${encodeURIComponent(groupId)}&page=matches&match=${encodeURIComponent(match.id)}`;
      pushResult = await sendGroupPush({
        title: `${group!.name} · Presença confirmada`,
        body: `${displayName} confirmou presença na ${match.title} do dia ${when.date}.`,
        tag: `attendance-${match.id}-${player.id}-${Date.now()}`,
        url: targetUrl,
        data: { groupId, matchId: match.id, playerId: player.id, eventType: "attendance-confirmed" },
        excludeUserId: user.id,
      });
      return json({ attendance, ...pushResult, action });
    }

    if (action === "attendance-declined") {
      const matchId = cleanText(payload.matchId, 64);
      const playerId = cleanText(payload.playerId, 64);
      if (!matchId || !playerId) return json({ error: "Evento ou membro não informado.", code: "ATTENDANCE_TARGET_REQUIRED" }, 400);

      stage = "load-declined-attendance";
      const { data: attendance, error: attendanceError } = await adminClient.from("match_attendance")
        .select("id,status,player_id")
        .eq("group_id", groupId).eq("match_id", matchId).eq("player_id", playerId).maybeSingle();
      if (attendanceError) throw attendanceError;
      if (!attendance || attendance.status !== "out") return json({ error: "A ausência ainda não está registrada.", code: "ATTENDANCE_NOT_DECLINED" }, 409);

      const [{ data: player, error: playerError }, { data: match, error: matchError }] = await Promise.all([
        adminClient.from("players").select("id,user_id,name,nickname").eq("id", playerId).eq("group_id", groupId).single(),
        adminClient.from("matches").select("id,group_id,title,starts_at").eq("id", matchId).eq("group_id", groupId).single(),
      ]);
      if (playerError) throw playerError;
      if (matchError) throw matchError;
      if (player.user_id !== user.id && !canManageMatches) return json({ error: "Você não pode notificar a alteração deste jogador.", code: "FORBIDDEN" }, 403);

      const when = formatDateTime(match.starts_at, cleanText(payload.timeZone, 80));
      const displayName = cleanText(player.nickname || player.name || "Um jogador", 80);
      const targetUrl = appOrigin
        ? `${appOrigin}/?group=${encodeURIComponent(groupId)}&page=matches&match=${encodeURIComponent(match.id)}`
        : `/?group=${encodeURIComponent(groupId)}&page=matches&match=${encodeURIComponent(match.id)}`;
      pushResult = await sendGroupPush({
        title: `${group!.name} · Alteração de presença`,
        body: `${displayName} alterou a resposta para “Não vou” na ${match.title} do dia ${when.date}.`,
        tag: `attendance-declined-${match.id}-${player.id}-${Date.now()}`,
        url: targetUrl,
        data: { groupId, matchId: match.id, playerId: player.id, eventType: "attendance-declined" },
        excludeUserId: user.id,
      });
      return json({ attendance, ...pushResult, action });
    }

    if (action === "attendance-reminder") {
      if (!canManageMatches) return json({ error: "Somente administrador ou organizador pode enviar lembretes de confirmação.", code: "FORBIDDEN" }, 403);
      const matchId = cleanText(payload.matchId, 64);
      const playerId = cleanText(payload.playerId, 64);
      if (!matchId || !playerId) return json({ error: "Evento ou membro não informado.", code: "REMINDER_TARGET_REQUIRED" }, 400);

      stage = "load-reminder-target";
      const [{ data: match, error: matchError }, { data: player, error: playerError }] = await Promise.all([
        adminClient.from("matches").select("id,group_id,title,starts_at,location,status").eq("id", matchId).eq("group_id", groupId).single(),
        adminClient.from("players").select("id,group_id,user_id,name,nickname,active").eq("id", playerId).eq("group_id", groupId).single(),
      ]);
      if (matchError) throw matchError;
      if (playerError) throw playerError;
      if (new Date(match.starts_at).getTime() <= Date.now() || match.status === "cancelled") {
        return json({ error: "O lembrete só pode ser enviado para eventos ativos.", code: "MATCH_NOT_ACTIVE" }, 409);
      }
      if (!player.active || !player.user_id) {
        return json({ error: "O membro selecionado não possui uma conta ativa vinculada.", code: "PLAYER_WITHOUT_ACTIVE_USER" }, 409);
      }

      stage = "validate-reminder-membership";
      const { data: targetMembership, error: targetMembershipError } = await adminClient
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .eq("user_id", player.user_id)
        .maybeSingle();
      if (targetMembershipError) throw targetMembershipError;
      if (!targetMembership) return json({ error: "O destinatário não é mais membro deste grupo.", code: "TARGET_NOT_GROUP_MEMBER" }, 409);

      stage = "validate-reminder-attendance";
      const { data: attendance, error: attendanceError } = await adminClient.from("match_attendance")
        .select("id,status")
        .eq("group_id", groupId)
        .eq("match_id", matchId)
        .eq("player_id", playerId)
        .maybeSingle();
      if (attendanceError) throw attendanceError;
      if (attendance && ["confirmed", "waitlist", "out"].includes(String(attendance.status || ""))) {
        return json({ error: "Este membro já informou presença ou ausência neste evento.", code: "ATTENDANCE_ALREADY_ANSWERED" }, 409);
      }

      const when = formatDateTime(match.starts_at, cleanText(payload.timeZone, 80));
      const displayName = cleanText(player.nickname || player.name || "Membro", 80);
      const targetUrl = appOrigin
        ? `${appOrigin}/?group=${encodeURIComponent(groupId)}&page=matches&match=${encodeURIComponent(match.id)}`
        : `/?group=${encodeURIComponent(groupId)}&page=matches&match=${encodeURIComponent(match.id)}`;
      pushResult = await sendPushToUsers([player.user_id], {
        title: `${group!.name} · Confirme sua presença`,
        body: `${displayName}, confirme se você vai ou não vai participar de ${match.title}, dia ${when.date}, às ${when.time}.`,
        tag: `attendance-reminder-${match.id}-${player.id}-${Date.now()}`,
        url: targetUrl,
        data: { groupId, matchId: match.id, playerId: player.id, eventType: "attendance-reminder" },
      });
      return json({ match, player, attendance: attendance || null, ...pushResult, action });
    }

    if (action === "charge-created") {
      if (!canManageFinance) return json({ error: "Somente administrador ou tesoureiro pode notificar uma cobrança.", code: "FORBIDDEN" }, 403);
      const chargeId = cleanText(payload.chargeId, 64);
      if (!chargeId) return json({ error: "Cobrança não informada.", code: "CHARGE_REQUIRED" }, 400);

      stage = "load-charge";
      const { data: charge, error: chargeError } = await adminClient.from("charges")
        .select("id,group_id,player_id,description,amount,due_date")
        .eq("id", chargeId).eq("group_id", groupId).single();
      if (chargeError) throw chargeError;
      if (!charge.player_id) return json({ charge, sent: 0, failed: 0, subscriptions: 0, failureStatus: 0, failureReason: "", action });

      stage = "load-charge-player";
      const { data: player, error: playerError } = await adminClient.from("players")
        .select("id,user_id,name,nickname")
        .eq("id", charge.player_id).eq("group_id", groupId).single();
      if (playerError) throw playerError;
      if (!player.user_id) return json({ charge, player, sent: 0, failed: 0, subscriptions: 0, failureStatus: 0, failureReason: "", action });

      const amountLabel = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(charge.amount || 0));
      const description = cleanText(charge.description || "nova cobrança", 80);
      const dueDate = cleanText(charge.due_date, 20);
      const dueText = dueDate ? ` Vencimento: ${dueDate.split("-").reverse().join("/")}.` : "";
      const targetUrl = appOrigin
        ? `${appOrigin}/?group=${encodeURIComponent(groupId)}&page=finance`
        : `/?group=${encodeURIComponent(groupId)}&page=finance`;
      pushResult = await sendPushToUsers([player.user_id], {
        title: `${group!.name} · Nova cobrança`,
        body: `Foi criada uma cobrança de ${amountLabel} referente a ${description}.${dueText}`,
        tag: `charge-${charge.id}`,
        url: targetUrl,
        data: { groupId, chargeId: charge.id, playerId: player.id, eventType: "charge-created" },
      });
      return json({ charge, player, ...pushResult, action });
    }

    return json({ error: "Ação de notificação não reconhecida.", code: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao processar a notificação.";
    console.error("publish-announcement failed", { stage, message, error });
    return json({ error: message, code: "FUNCTION_FAILED", stage }, 500);
  }
});
