-- Execute uma única vez, depois da migração Beta 1.0.
-- Substitua o e-mail abaixo pelo e-mail Google usado por você no Tâmo On.

insert into public.platform_admins(email)
values (lower('SUBSTITUA_PELO_SEU_EMAIL_GOOGLE'))
on conflict (email) do nothing;

select email, created_at from public.platform_admins order by created_at;
