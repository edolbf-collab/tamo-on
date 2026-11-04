-- Ativação isolada já aplicada sob esta versão no projeto Comunidade.
-- Replica somente o armazenamento cifrado da preparação iOS; não altera exclusão de contas.
create table if not exists public.apple_auth_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  apple_subject text not null,
  encrypted_refresh_token text not null,
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.apple_auth_grants enable row level security;
revoke all on public.apple_auth_grants from public, anon, authenticated;
grant all on public.apple_auth_grants to service_role;
