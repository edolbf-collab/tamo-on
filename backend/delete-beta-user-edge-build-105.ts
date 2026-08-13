import { createClient } from "npm:@supabase/supabase-js@2.110.7";

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

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" }, 405);

  let stage = "startup";
  let auditId = "";
  let prepared = false;

  try {
    const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
    const publicKey = keyFromEnvironment("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = keyFromEnvironment("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !publicKey || !secretKey) {
      return json({ error: "As credenciais internas do Supabase não estão disponíveis na Edge Function.", code: "SUPABASE_ENV_MISSING" }, 500);
    }

    const authorization = String(req.headers.get("Authorization") || "").trim();
    if (!authorization.startsWith("Bearer ")) return json({ error: "Sessão não informada.", code: "AUTH_HEADER_MISSING" }, 401);
    const accessToken = authorization.slice(7).trim();
    if (!accessToken) return json({ error: "Sessão inválida.", code: "AUTH_TOKEN_EMPTY" }, 401);

    const userClient = createClient(supabaseUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    stage = "authenticate-admin";
    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
    const actor = userData.user;
    if (userError || !actor) return json({ error: "Sessão inválida ou expirada.", code: "AUTH_INVALID" }, 401);

    const actorEmail = String(actor.email || "").trim().toLowerCase();
    const { data: platformAdmin, error: platformAdminError } = await adminClient
      .from("platform_admins")
      .select("email")
      .eq("email", actorEmail)
      .maybeSingle();
    if (platformAdminError) throw platformAdminError;
    if (!platformAdmin) return json({ error: "Acesso restrito à administração da plataforma.", code: "PLATFORM_ADMIN_REQUIRED" }, 403);

    stage = "validate-input";
    const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
    const targetEmail = cleanText(payload.email, 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      return json({ error: "Informe um e-mail válido.", code: "EMAIL_INVALID" }, 400);
    }
    if (targetEmail === actorEmail) {
      return json({ error: "Você não pode excluir permanentemente a própria conta administrativa.", code: "SELF_DELETE_FORBIDDEN" }, 400);
    }

    stage = "load-target";
    const { data: betaAccess, error: betaAccessError } = await adminClient
      .from("beta_access")
      .select("email,status,user_id")
      .eq("email", targetEmail)
      .maybeSingle();
    if (betaAccessError) throw betaAccessError;
    if (!betaAccess) return json({ error: "E-mail não encontrado na lista do beta.", code: "BETA_ACCESS_NOT_FOUND" }, 404);

    const { data: targetPlatformAdmin, error: targetAdminError } = await adminClient
      .from("platform_admins")
      .select("email")
      .eq("email", targetEmail)
      .maybeSingle();
    if (targetAdminError) throw targetAdminError;
    if (targetPlatformAdmin) {
      return json({ error: "Outro administrador da plataforma não pode ser excluído por esta ferramenta.", code: "TARGET_IS_PLATFORM_ADMIN" }, 409);
    }

    const targetUserId = String(betaAccess.user_id || "").trim();
    const targetEmailHash = await sha256(targetEmail);
    const targetUserIdHash = targetUserId ? await sha256(targetUserId) : null;

    stage = "create-audit";
    const { data: audit, error: auditError } = await adminClient
      .from("platform_user_deletion_audit")
      .insert({
        actor_user_id: actor.id,
        target_email_hash: targetEmailHash,
        target_user_id_hash: targetUserIdHash,
        status: "started",
        stage,
      })
      .select("id")
      .single();
    if (auditError) throw auditError;
    auditId = String(audit.id || "");

    // Convite que ainda não criou conta: basta remover a autorização.
    if (!targetUserId) {
      stage = "remove-invitation";
      const { error: removeInviteError } = await adminClient.from("beta_access").delete().eq("email", targetEmail);
      if (removeInviteError) throw removeInviteError;

      await adminClient.from("platform_user_deletion_audit").update({
        status: "completed",
        stage: "completed",
        summary: { invitation_removed: true },
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", auditId);

      return json({
        ok: true,
        invitationOnly: true,
        message: "Autorização pendente removida permanentemente.",
        summary: { invitation_removed: true },
      });
    }

    stage = "prepare-database";
    const { data: summary, error: prepareError } = await adminClient.rpc("platform_prepare_beta_user_deletion", {
      p_target_user_id: targetUserId,
      p_target_email: targetEmail,
      p_actor_user_id: actor.id,
      p_actor_email: actorEmail,
    });
    if (prepareError) throw prepareError;
    prepared = true;

    await adminClient.from("platform_user_deletion_audit").update({
      status: "prepared",
      stage,
      summary: summary || {},
      updated_at: new Date().toISOString(),
    }).eq("id", auditId);

    stage = "delete-auth-user";
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(targetUserId, false);
    if (authDeleteError) throw authDeleteError;

    stage = "remove-beta-access";
    const { error: betaDeleteError } = await adminClient.from("beta_access").delete().eq("email", targetEmail);
    if (betaDeleteError) throw betaDeleteError;

    stage = "complete-audit";
    await adminClient.from("platform_user_deletion_audit").update({
      status: "completed",
      stage: "completed",
      summary: summary || {},
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", auditId);

    return json({
      ok: true,
      invitationOnly: false,
      message: "Usuário excluído permanentemente.",
      summary: summary || {},
    });
  } catch (error) {
    const message = cleanText((error as { message?: string })?.message || "Falha ao excluir o usuário.", 500);
    console.error("Falha na exclusão permanente do beta", { stage, prepared, error });

    try {
      if (auditId) {
        const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
        const secretKey = keyFromEnvironment("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
        if (supabaseUrl && secretKey) {
          const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
          await adminClient.from("platform_user_deletion_audit").update({
            status: "failed",
            stage,
            error_code: message.slice(0, 180),
            updated_at: new Date().toISOString(),
          }).eq("id", auditId);
        }
      }
    } catch (auditFailure) {
      console.error("Falha ao atualizar auditoria de exclusão", auditFailure);
    }

    return json({
      error: prepared
        ? "A preparação foi executada e o acesso ficou bloqueado, mas a conta não pôde ser removida do Auth. Tente novamente após verificar a etapa informada."
        : message,
      detail: message,
      code: "PERMANENT_DELETE_FAILED",
      stage,
      prepared,
    }, 500);
  }
});
