// No email/UID from the caller is used to select the Marketplace account.
export function createHandler({createClient, env, communityUrl, communityKey}) {
  const origins = new Set(["https://app.tamoon.app.br", "https://resenhafc-beta.pages.dev", "https://marketplace-build-166.resenhafc-beta.pages.dev"]);
  const key = (plural, legacy) => {
    try { const parsed = JSON.parse(env(plural) || "{}"); if (parsed.default) return parsed.default; } catch {}
    return env(legacy);
  };
  return async req => {
    const origin = req.headers.get("origin");
    const headers = {"Content-Type":"application/json", "Cache-Control":"no-store", "Vary":"Origin"};
    if (origin && origins.has(origin)) Object.assign(headers, {
      "Access-Control-Allow-Origin":origin, "Access-Control-Allow-Headers":"authorization, content-type, apikey, x-client-info",
      "Access-Control-Allow-Methods":"POST, OPTIONS"
    });
    const reply = (status, body) => {
      if (status >= 400) console.warn("marketplace_pilot_access", JSON.stringify({reason:body.error, origin, ios:/iPhone|iPad/.test(req.headers.get("user-agent") || "")}));
      return new Response(JSON.stringify(body), {status, headers});
    };
    if (origin && !origins.has(origin)) return reply(403, {error:"ORIGIN_DENIED"});
    if (req.method === "OPTIONS") return new Response(null, {status:204, headers});
    if (req.method !== "POST") return reply(405, {error:"METHOD_NOT_ALLOWED"});
    const authorization = req.headers.get("authorization") || "";
    if (!/^Bearer \S+$/.test(authorization)) return reply(401, {error:"AUTH_REQUIRED"});
    try {
      const body = await req.json();
      if (!["status","session","import_group"].includes(body.action)) return reply(400, {error:"INVALID_ACTION"});
      const community = createClient(communityUrl, communityKey, {
        auth:{persistSession:false, autoRefreshToken:false}, global:{headers:{Authorization:authorization}}
      });
      const {data:identity, error:authError} = await community.auth.getUser(authorization.slice(7));
      if (authError || !identity?.user) return reply(401, {error:"AUTH_REQUIRED"});
      const user = identity.user;
      if (!user.email_confirmed_at || !user.identities?.some(i => ["google", "apple"].includes(i.provider))) return reply(403, {error:"PILOT_RESTRICTED"});
      const url = env("SUPABASE_URL");
      const admin = createClient(url, key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), {auth:{persistSession:false, autoRefreshToken:false}});
      // Service-only allowlist; the email comes from Auth, never from the request body.
      const {data:mapping, error:mappingError} = await admin.rpc("community_marketplace_pilot_identity", {
        p_community_id:user.id, p_exchange:body.action === "session", p_verified_email:user.email
      });
      if (mappingError || !mapping?.marketplace_id || mapping.email?.toLowerCase() !== user.email?.toLowerCase()) return reply(mappingError?.code === "PT429" ? 429 : 403, {error:"PILOT_RESTRICTED"});
      const legalAccess = await community.rpc("get_community_legal_access_status");
      if (legalAccess.error) return reply(503, {error:"ACCESS_UNAVAILABLE"});
      if (legalAccess.data?.allowed !== true) return reply(403, {error:"LEGAL_ACCEPTANCE_REQUIRED"});
      const canSyncCommunity = mapping.can_sync_community === true;
      if (body.action === "import_group") {
        if (!canSyncCommunity) return reply(403, {error:"PILOT_GROUP_DENIED"});
        const context = await community.rpc("community_marketplace_pilot_context");
        if (context.error || context.data?.user_id !== user.id || context.data?.marketplace_user_id !== mapping.marketplace_id) return reply(403,{error:"PILOT_GROUP_DENIED"});
        const imported = await admin.rpc("pilot_import_community_group",{p_context:context.data});
        if (imported.error) return reply(503,{error:"GROUP_IMPORT_FAILED"});
        return reply(200,{group_id:imported.data,community_group_id:context.data.group_id,name:context.data.name});
      }
      if (body.action === "status") return reply(200, {allowed:true, canSyncCommunity, environment:"staging", realMoney:false});
      const {data:link, error:linkError} = await admin.auth.admin.generateLink({type:"magiclink", email:mapping.email});
      if (linkError || link.user?.id !== mapping.marketplace_id || !link.properties?.hashed_token) return reply(503, {error:"SESSION_UNAVAILABLE"});
      const client = createClient(url, key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), {auth:{persistSession:false, autoRefreshToken:false}});
      const {data:verified, error:verifyError} = await client.auth.verifyOtp({token_hash:link.properties.hashed_token, type:"magiclink"});
      if (verifyError || verified.user?.id !== mapping.marketplace_id || !verified.session) return reply(503, {error:"SESSION_UNAVAILABLE"});
      // Generates a session without sending an email; tokens stay out of URLs and logs.
      return reply(200, {session:{access_token:verified.session.access_token, refresh_token:verified.session.refresh_token}, canSyncCommunity, environment:"staging", realMoney:false});
    } catch {
      return reply(503, {error:"ACCESS_UNAVAILABLE"});
    }
  };
}
