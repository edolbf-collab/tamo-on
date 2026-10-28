// Deployed to Community. One authenticated operator, one configured group, two verified sessions.
export function createGateway({createClient,env,marketUrl,marketKey,fetcher=fetch}) {
  const origins=new Set(['https://app.tamoon.app.br','https://marketplace-build-166.resenhafc-beta.pages.dev']);
  const key=(plural,legacy)=>{try{const v=JSON.parse(env(plural)||'{}');if(v.default)return v.default}catch{}return env(legacy)};
  return async req=>{
    const origin=req.headers.get('origin');
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(origins.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type,x-marketplace-authorization','Access-Control-Allow-Methods':'POST,OPTIONS'});
    const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers});
    if(origin&&!origins.has(origin))return reply(403,{error:'ORIGIN_DENIED'});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
    const bearer=req.headers.get('authorization')||'', mb=req.headers.get('x-marketplace-authorization')||'';
    if(!/^Bearer \S+$/.test(bearer)||!/^Bearer \S+$/.test(mb))return reply(401,{error:'AUTH_REQUIRED'});
    try {
      const body=await req.json();if(body.action!=='sync')return reply(400,{error:'INVALID_ACTION'});
      const options=token=>({auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:token}}});
      const community=createClient(env('SUPABASE_URL'),key('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY'),options(bearer));
      const market=createClient(marketUrl,marketKey,options(mb));
      const [cu,mu]=await Promise.all([community.auth.getUser(bearer.slice(7)),market.auth.getUser(mb.slice(7))]);
      if(cu.error||mu.error||!cu.data?.user||!mu.data?.user)return reply(401,{error:'AUTH_REQUIRED'});
      const ctx=await community.rpc('community_marketplace_pilot_context');
      if(ctx.error||ctx.data?.user_id!==cu.data.user.id||ctx.data?.marketplace_user_id!==mu.data.user.id)return reply(403,{error:'PILOT_GROUP_DENIED'});
      // The import is performed in Marketplace by its own authenticated bridge (server-only RPC).
      const importResponse=await fetcher(marketUrl+'/functions/v1/community-marketplace-session',{
        method:'POST',headers:{Authorization:bearer,'Content-Type':'application/json'},body:JSON.stringify({action:'import_group'})
      });
      if(!importResponse.ok)return reply(503,{error:'GROUP_IMPORT_FAILED'});
      const exported=await market.rpc('pilot_export_community_events');
      if(exported.error||!Array.isArray(exported.data))return reply(403,{error:'MARKETPLACE_EXPORT_DENIED'});
      const admin=createClient(env('SUPABASE_URL'),key('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
      const applied=await admin.rpc('community_marketplace_pilot_apply',{p_actor:cu.data.user.id,p_items:exported.data});
      if(applied.error)return reply(503,{error:'SYNC_FAILED'});
      return reply(200,{...applied.data,group_name:ctx.data.name});
    } catch{return reply(503,{error:'SYNC_UNAVAILABLE'})}
  };
}
