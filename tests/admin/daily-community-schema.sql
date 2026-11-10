-- Schema-only dependencies for administrative tests. No real records.
create schema tamoon_safety;
create table tamoon_safety.reports(id uuid primary key,group_id uuid,target_type text,details text,snapshot jsonb,status text,created_at timestamptz,updated_at timestamptz);
create table public.beta_feedback(id uuid primary key,user_id uuid,group_id uuid,title text,description text,context jsonb,status text,created_at timestamptz,updated_at timestamptz);
