import {createClient} from 'npm:@supabase/supabase-js@2.110.7';
import {env,serviceKey,publicKey,exchangeAppleCode,encryptToken} from '../_shared/apple.ts';
import {createAppleHandler} from './handler.mjs';
Deno.serve(createAppleHandler({createClient,env,serviceKey,publicKey,exchangeAppleCode,encryptToken}));
