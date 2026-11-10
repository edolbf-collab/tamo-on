# Central administrativa — primeira entrega

Base: 1.0.171 (177), commit 71848dc. Branch isolada: `feat/admin-operations`.

## Implementado

- Comunidade: grupos, responsável registrado, administradores, participantes, eventos, usuários e vínculos; notificações Android, iOS e Web.
- Marketplace: Central de operações no menu lateral; parceiros, reservas, pagamentos, vínculos mensais, ciclos de mensalidade e auditoria.
- Busca literal por nome/e-mail/código/ID e dados da ficha; filtro por situação e criação; paginação de 20 no servidor; ficha atualizada e navegação entre registros relacionados.
- Dados somente em memória, com descarte ao trocar identidade/fechar painel e proteção contra respostas antigas.
- Origem dos novos grupos preservada. Grupos antigos: criador original não comprovado, pois o responsável registrado pode ter sido transferido durante exclusão de conta. A exclusão do criador remove sua referência sem manter cópias de nome/e-mail.
- Auditoria informa autor, ação, registro e campos alterados; não expõe valores antigos/novos, metadados arbitrários, tokens ou credenciais.
- Saúde/suporte, denúncias e devoluções existentes permanecem acessíveis. Esta central consulta informações; não executa cobranças, estornos, repasses ou mudanças de permissões.

## Implantação posterior à validação

Nenhuma migração foi aplicada aos bancos hospedados. Nenhuma nova versão foi publicada nas lojas.
1. Aplicar `supabase/migrations/20261110151314_admin_operations.sql` na Comunidade (`xvwgrpnioaqyijhzqxqh`).
2. Aplicar `integration/marketplace/supabase/migrations/20261110151321_admin_operations.sql` no Marketplace staging (`owybghlwcohfyapvsfdo`).
3. Executar advisors e smoke tests autenticados: admin autorizado, usuário comum negado; conferir totais com consultas de referência.
4. Publicar frontend após migrações. Incrementar versão/build, reconstruir pacotes nativos e validar Android/iPhone antes do envio às lojas.
5. Validar operacionalmente um grupo (responsáveis, participantes e eventos), os três canais de push e um caso do marketplace.

O schema `tamoon_admin` permanece privado, fora da Data API. A função pública SECURITY INVOKER chama implementação privada SECURITY DEFINER com guarda explícita de administrador no banco. Nenhuma tabela de negócio recebe novas permissões.

## Verificação

- `node --test mobile/tests/admin-operations.test.mjs`: PGlite/PostgreSQL, administração, anonimato, paginação, filtros, ausência de tokens, preservação de origem e exclusão do criador.
- `npm ci --prefix tests/admin && npm test --prefix tests/admin`: DOM simulado, navegação/filtros, fichas/vínculos, respostas atrasadas, falhas, isolamento de identidade e integração com o painel existente.
- `node mobile/tests/admin-operations-browser.mjs`: Chromium, larguras 320/390/768/1280, cliques, XSS e estados de erro; apenas dados fictícios. Executado pelo workflow Administrative operations validation.
- `npm run build --prefix mobile && npm run check --prefix mobile`: recursos nativos, política de conteúdo e separação de segredos. Não substitui compilação Swift/Android nem testes físicos.
- Suíte de regressão + banco: 244 testes; DOM simulado: 3 testes. Recuperação das alterações e nova execução após restauração do ambiente em 10/11/2026.

## Próximas entregas

A primeira entrega é a base de consulta, não toda a auditoria:
- Indicadores consolidados, fila de pendências/SLA, agenda global e reconciliação financeira.
- Dossiês financeiros completos, taxas/comissões, repasses comprovados, vouchers e webhooks.
- Suporte com responsável/prazo, histórico de convites, exportações completas e relatórios de crescimento.
- Papéis administrativos e trilha das intervenções; configurações persistidas no servidor.
- O diagnóstico legado de Saúde/suporte ainda possui contadores de Web Push. A nova Central de Notificações inclui Android/iOS/Web; unificar os indicadores legados na próxima entrega.

Aceite pelo provedor não comprova exibição no telefone. O período da lista filtra criação do registro; data do jogo, competência e liquidação aparecem na ficha quando aplicáveis.
