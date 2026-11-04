import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

function firstKeyFromJson(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') return parsed.default || Object.values(parsed)[0];
  } catch {
    return raw;
  }
  return undefined;
}

export function supabaseUrl(): string {
  const value = Deno.env.get('SUPABASE_URL');
  if (!value) throw new Error('SUPABASE_URL ausente');
  return value;
}

export function publishableKey(): string {
  return firstKeyFromJson('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY') || '';
}

export function secretKey(): string {
  return firstKeyFromJson('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

export function adminClient(): SupabaseClient {
  const key = secretKey();
  if (!key) throw new Error('Chave secreta do Supabase ausente');
  return createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function userClient(req: Request): SupabaseClient {
  const key = publishableKey();
  if (!key) throw new Error('Chave publicável do Supabase ausente');
  return createClient(supabaseUrl(), key, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request, options: { allowReadOnly?: boolean } = {}) {
  const client = userClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('UNAUTHORIZED');
  if (!options.allowReadOnly) {
    const { data: writable, error: guardError } = await client.rpc('assert_marketplace_writable');
    if (guardError || writable !== true) throw new Error(guardError?.message || 'PARTNER_PREVIEW_READ_ONLY');
  }
  return { user: data.user, client };
}
