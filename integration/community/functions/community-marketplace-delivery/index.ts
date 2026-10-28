import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createDeliveryHandler } from "./handler.mjs";
const key=()=>{try{const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');if(keys.default)return keys.default}catch{}return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')};
Deno.serve(createDeliveryHandler({apply:async body=>{
 const client=createClient(Deno.env.get('SUPABASE_URL')!,key()!,{auth:{persistSession:false,autoRefreshToken:false}});
 return client.rpc('community_marketplace_pilot_receive',body);
}}));
