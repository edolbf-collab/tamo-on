-- Tâmo On Build 157 — ativação após publicação do frontend e das duas Edges.
-- Os DOCX v1.2 deixam a vigência a definir. Substitua NULL pela data acordada:
-- exemplo de formato: 'AAAA-MM-DD 00:00:00-03'::timestamptz (não usar literalmente).
-- Execute a partir dessa data. Sem data explícita, o SQL interrompe sem ativar.
begin;
select tamoon_legal.activate_v1_2(NULL::timestamptz);
commit;
