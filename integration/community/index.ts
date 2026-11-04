import {createClient} from "npm:@supabase/supabase-js@2.57.4";
import {createGateway} from "./pilot-gateway.mjs";
Deno.serve(createGateway({createClient,env:(name:string)=>Deno.env.get(name),marketUrl:"https://owybghlwcohfyapvsfdo.supabase.co",marketKey:"sb_publishable_wuVVHMVrCI1MplRzcezIfA_HHTXooiE"}));
