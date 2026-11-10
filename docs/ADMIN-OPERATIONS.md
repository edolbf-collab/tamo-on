# Central administrativa — entregas web

Base: 1.0.171 (177), commit 71848dc. Branch isolada: `feat/admin-operations`.

## Implementado

- Comunidade: grupos, responsável registrado, administradores, participantes, eventos, usuários e vínculos; notificações Android, iOS e Web.
- Marketplace: Central de operações no menu lateral; parceiros, reservas, pagamentos, vínculos mensais, ciclos de mensalidade e auditoria.
- Busca literal por nome/e-mail/código/ID e dados da ficha; filtro por situação e criação; paginação de 20 no servidor; ficha atualizada e navegação entre registros relacionados.
- Dados somente em memória, com descarte ao trocar identidade/fechar painel e proteção contra respostas antigas.
- Origem dos novos grupos preservada. Grupos antigos: criador original não comprovado, pois o responsável registrado pode ter sido transferido durante exclusão de conta. A exclusão do criador remove sua referência sem manter cópias de nome/e-mail.
- Auditoria informa autor, ação, registro e campos alterados; não expõe valores antigos/novos, metadados arbitrários, tokens ou credenciais.
- Saúde/suporte, denúncias e devoluções existentes permanecem acessíveis. Esta central consulta informações; não executa cobranças, estornos, repasses ou mudanças de permissões.

## Implantação web e fluxo de aprovação

Autorização de 10/11/2026: publicar na web para validação do titular. Revisão web `171-ADMIN1`, preservando a numeração dos pacotes já enviados às lojas.

1. Migração `20261110171752_admin_operations.sql` da Comunidade aplicada em `xvwgrpnioaqyijhzqxqh`.
2. Migração `20261110171834_admin_operations.sql` do Marketplace aplicada em `owybghlwcohfyapvsfdo`, mantendo o piloto restrito e o sandbox.
Os identificadores dos arquivos foram alinhados ao histórico registrado pelo servidor, preservando o SQL aplicado e evitando reaplicação futura.

3. Smoke tests hospedados: as 11 seções responderam sob o papel authenticated com identidade administrativa; totais conferidos com as tabelas de referência. Usuário comum e anônimo negados; acesso direto às projeções negado. Transações de verificação encerradas com ROLLBACK, sem modificar registros de negócio.
4. Advisors: nenhuma nova advertência de segurança. Apenas informação esperada de RLS sem políticas na tabela privada de origens, cujo acesso direto permanece revogado.
5. Publicação do frontend pelo fluxo GitHub → Cloudflare Pages (`resenhafc-beta`), com confirmação em `https://app.tamoon.app.br/version.json` antes do aviso de disponibilidade.

Fluxo permanente acordado:
- Funcionalidades são publicadas e validadas primeiro na web.
- Alterações dependentes do dispositivo usam teste Android e TestFlight iOS.
- Envio às lojas somente após aprovação do titular.
- Não iniciar nova submissão iOS enquanto a 1.0.171 (177) estiver pendente de publicação.

Acesso na web: **Mais → Painel da plataforma**. No Marketplace: **Administração → Central de operações**. Saúde e suporte, denúncias e devoluções continuam disponíveis.

O schema `tamoon_admin` permanece privado, fora da Data API. A função pública SECURITY INVOKER chama implementação privada SECURITY DEFINER com guarda explícita de administrador no banco. Nenhuma tabela de negócio recebe novas permissões.

## Verificação

- `node --test mobile/tests/admin-operations.test.mjs`: PGlite/PostgreSQL, administração, anonimato, paginação, filtros, ausência de tokens, preservação de origem e exclusão do criador.
- `npm ci --prefix tests/admin && npm test --prefix tests/admin`: DOM simulado, navegação/filtros, fichas/vínculos, respostas atrasadas, falhas, isolamento de identidade e integração com o painel existente.
- `node mobile/tests/admin-operations-browser.mjs`: Chromium, larguras 320/390/768/1280, cliques, XSS e estados de erro; apenas dados fictícios. Executado pelo workflow Administrative operations validation.
- `npm run build --prefix mobile && npm run check --prefix mobile`: recursos nativos, política de conteúdo e separação de segredos. Não substitui compilação Swift/Android nem testes físicos.
- Suíte de regressão + banco: 244 testes; DOM simulado: 3 testes. Recuperação das alterações e nova execução após restauração do ambiente em 10/11/2026.

## Segunda entrega — controle financeiro (171-ADMIN2)

Aprovação da primeira entrega e autorização para prosseguir em 10/11/2026. As funcionalidades continuam sendo validadas na web; o envio às lojas será consolidado após a aprovação do conjunto.

- Fichas financeiras por reserva com os cálculos oficiais de `private.reservation_financial_snapshot`, sem duplicar regras no navegador.
- Pendências: devoluções, resolução, excedentes, revisão financeira e pedidos ao provedor rejeitados ou incertos.
- Navegação da ficha para cobranças, pagamentos, cotas, etapas mensais, datas, movimentos, vouchers, créditos comprovados e pedidos de devolução.
- Créditos de liquidação e de split são identificados pela evidência existente; não representam saldo para saque. Datas de referência do split são explicitamente identificadas.
- Retornos do provedor mostram situação, tentativas, recebimento/processamento e vínculos encontrados. Payloads, erros arbitrários, chaves, URLs de cobrança, carteiras e tokens não são retornados.
- Integrações por parceiro e configurações efetivas do servidor, somente para consulta. As configurações não são substituídas por preferências locais.
- Datas dos filtros refletem o tipo de registro: criação, vencimento, ocorrência, movimento, recebimento ou atualização.

Migração `integration/marketplace/supabase/migrations/20261110182151_admin_financial_operations.sql` aplicada exclusivamente no Marketplace de homologação. As 13 novas seções foram consultadas com identidade administrativa e paginação de 20; nenhuma operação financeira foi executada.

Validação adicional: PostgreSQL/PGlite com cálculo oficial, excedente, voucher, mensalidade parcial, devolução pendente, vínculos, datas, permissão negada e ausência de campos privados; DOM e Chromium com navegação financeira e larguras 320/390/768/1280. As fixtures financeiras contêm apenas definições de schema e dados fictícios. A view de validade de vouchers é uma dependência existente e usa fixture de contrato; suas regras não foram alteradas.

## Terceira entrega — gestão diária (171-ADMIN3)

Autorizada em 10/11/2026 após o usuário considerar a consulta completa, porém complexa. A entrada passa a ter três áreas: **Resumo**, **Pendências e suporte** e **Agenda geral**. As telas anteriores ficam disponíveis em **Consultas detalhadas**.

- Resumo de cada ambiente, com quatro indicadores e até cinco pendências prioritárias. Comunidade e Marketplace mantêm fontes e permissões separadas.
- Fila da Comunidade: relatos de problema, denúncias, falhas de envio e atendimentos internos. Fila do Marketplace: pendências financeiras oficiais, parceiros aguardando análise, falhas/atrasos de processamento e atendimentos internos.
- Acompanhamento persistido: responsável administrativo, prazo, andamento, nota interna e histórico. O prazo é interno e opcional; não representa compromisso automático com o usuário.
- Atendimentos internos e relatos de problema podem ser encerrados. Denúncias, financeiro e integrações seguem o estado da origem; registrar acompanhamento não altera pagamentos, estornos ou decisões de moderação. Devoluções têm atalho para o fluxo existente.
- Agenda em ordem cronológica, por data real e duração, com busca, grupo/parceiro e situação. Inclui eventos que atravessam a meia-noite. O período inicial é de sete dias e os horários seguem o fuso do aparelho.
- Paginação no servidor (20), descarte de dados após troca de identidade, proteção contra respostas atrasadas, versão de acompanhamento e criação idempotente de atendimentos.
- Nenhuma comunicação externa automática. Dados técnicos arbitrários e credenciais não entram nas projeções.

Migrações aplicadas: Comunidade `20261110192433_admin_daily_operations.sql`; Marketplace `20261110192442_admin_daily_operations.sql`. Leitura e gravação administrativa verificadas no servidor; usuário comum, anônimo e acesso direto negados. Gravações de teste desfeitas com ROLLBACK. Advisors sem novas advertências, somente informações esperadas de RLS fechado nas três tabelas privadas.

Validação: 8 cenários de banco/navegação e 6 de DOM; navegador automatizado com larguras 320/390/768/1280 e capturas da visão geral, suporte e agenda; build/check do pacote web. A verificação real de uso será feita na web pelo titular. Esta entrega não é uma submissão às lojas.

## Próximas entregas

A primeira entrega é a base de consulta, não toda a auditoria:
- Evoluir indicadores e prazos operacionais conforme a experiência com a gestão diária.
- Evoluir a conferência financeira conforme os casos observados na homologação; os dossiês e referências iniciais já estão na segunda entrega.
- Histórico de convites, exportações completas e relatórios de crescimento.
- Papéis administrativos e trilha das intervenções; configurações persistidas no servidor.
- O diagnóstico legado de Saúde/suporte ainda possui contadores de Web Push. A nova Central de Notificações inclui Android/iOS/Web; unificar os indicadores legados na próxima entrega.

Aceite pelo provedor não comprova exibição no telefone. O período da lista filtra criação do registro; data do jogo, competência e liquidação aparecem na ficha quando aplicáveis.
