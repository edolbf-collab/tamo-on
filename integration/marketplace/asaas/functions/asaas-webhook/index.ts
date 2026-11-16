import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { processWebhookEvent } from '../_shared/webhook-processing.ts';
import { handleAsaasWebhook } from './handler.mjs';
Deno.serve((req) => handleAsaasWebhook(req,{env:(name:string)=>Deno.env.get(name),adminClient,processWebhookEvent,jsonResponse,corsHeaders}));
