import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createHandler } from "./handler.mjs";
Deno.serve(createHandler({createClient, env:(name: string) => Deno.env.get(name),
  communityUrl:"https://xvwgrpnioaqyijhzqxqh.supabase.co",
  communityKey:"sb_publishable_d0sXTfLf9ZNhDNbDfVhRYg_ZfNjQscs"
}));
