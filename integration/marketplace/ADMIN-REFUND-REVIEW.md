# Devoluções centralizadas na Administração

Implementação sobre `main` em `776de03`. Implantação autorizada em 05/11/2026. Banco atualizado no Marketplace Staging; processador `asaas-refund` publicado na versão 13. Esta revisão entrega a interface web correspondente.

## Comportamento

Usuário e parceiro continuam solicitando cancelamento/restituição nos caminhos existentes. Os direitos, a liberação de horários, a escolha individual de vouchers e a contabilização não foram modificados. Os solicitantes acompanham estados simples, sem notas internas ou informações de saldo.

A Administração acessa **Devoluções** pelo menu lateral, junto de Financeiro, Reservas e Vouchers. O menu móvel oferece o mesmo acesso. Os atalhos existentes em **Cancelamentos e restituições** abrem essa mesma área. A fila inclui obrigações financeiras anteriores e novas, inclusive pedidos relativos a ocorrências mensalistas. Os detalhes exibem valor previsto, devolvido e pendente, motivo, pagamentos, responsável e histórico. A análise permite continuar em avaliação, aguardar saldo ou aprovar execução; não movimenta dinheiro. O responsável é quem registra a análise. Pode programar acompanhamento em 12, 24 ou 48 horas. O destaque após dois dias é operacional, não uma definição de prazo legal.

## Tela dedicada — 06/11/2026

- Quatro indicadores acompanham os filtros: pedidos pendentes, aguardando saldo, em processamento e total a devolver. O contador no menu mantém o total de pedidos pendentes.
- Filtros por código de reserva, situação, parceiro e período de solicitação. A seleção inicial apresenta as pendências, com acompanhamentos vencidos primeiro e pedidos mais antigos em seguida. A lista tem páginas de 15 pedidos.
- A lista compacta mostra reserva, parceiro, situação, data e valor pendente. Notas, pagamentos, responsável, análise e histórico ficam nos detalhes. O botão repetido no cabeçalho foi retirado.
- Ao salvar uma análise, os mesmos detalhes são reabertos e os filtros são preservados. A fila é atualizada após mudanças recebidas do backend e a cada minuto enquanto a tela está visível e nenhuma análise ou confirmação está em curso.
- Falha de consulta apresenta aviso e nova tentativa; não é mostrada como fila vazia nem saldo zero. Pedidos e filtros ficam somente na memória, vinculados à identidade administrativa ativa. Perda de acesso invalida respostas pendentes e fecha os detalhes administrativos.
- Esta revisão altera apenas a interface e seus testes. Não reaplica migrações, não publica funções do processador e não habilita dinheiro real. O teste com uma pequena movimentação real permanece para o início da operação.

Validação desta revisão: 166 testes Node aprovados, sintaxe e bundle conferidos. Fluxo exercitado em Chromium com serviços simulados: menu, filtros, detalhes, gravação de análise e bloqueio por saldo insuficiente. A conferência visual usa telas de computador e larguras móveis; não representa teste em aparelho físico nem transação real.

Somente administradores ativos podem consultar o processador e executar devoluções, incluindo registro de devolução externa. As regras são impostas no servidor, inclusive para clientes antigos. Uma alteração nos valores, escolha de voucher ou confirmação parcial invalida a aprovação anterior. Após cada pagamento confirmado, os valores restantes precisam ser revisados. Uma reserva não pode ter dois pagamentos em execução simultânea.

Na consulta de saldos, a conta emissora e a conta principal são consultadas com suas próprias credenciais. A parcela do split é calculada pelo código de conciliação já existente. A conferência é repetida imediatamente antes do POST. Consulta indisponível ou saldo insuficiente bloqueia o envio. Não há aporte, Pix avulso ou débito futuro automático. O saldo pode mudar entre consulta e execução; a resposta do provedor continua sendo tratada.

Uma resposta HTTP bem-sucedida registra envio, não conclusão. A confirmação continua dependendo de evidência do provedor/webhook. Timeouts após envio ficam como resultado desconhecido, sem repetição automática. Falta de saldo coloca o caso em espera e exige nova aprovação.

## Limites preservados

- Apenas Asaas Sandbox: este pacote não habilita dinheiro real.
- Restituições parciais por ocorrência mensalista e casos de conciliação incompatível aparecem na fila, mas conservam a limitação atual de execução. Não é enviado um estorno integral indevido. A análise pode registrar providências, porém o pacote não acrescenta Pix avulso nem conciliação manual de pagamentos digitais.
- Nenhum pagamento real ou estorno real foi realizado durante a validação.
- Não foi gerado AAB ou IPA. Android TWA usará a versão web após publicação; o pacote iOS 171 em revisão não é atualizado por este incremental. A interface precisa entrar em um próximo build iOS. A proteção do servidor, quando aplicada, também abrange clientes antigos; nesse intervalo a Administração opera pela web.

## Validação da integração financeira anterior

- 156 testes Node de Marketplace, autenticação e integração da Comunidade.
- Teste transacional no projeto Marketplace Staging, com migração e fixtures revertidos por ROLLBACK. Cobriu bloqueio de usuários/parceiros, aprovação, espera de saldo, aprovação invalidada, concorrência, notificações internas, vouchers, duplicidade e confirmação de devolução.
- Verificação de privilégios: anônimo não executa a fila; usuário autenticado não chama claim nem lê as tabelas internas.
- Chromium em viewport móvel: acesso anônimo, negado, administrador, usuário e parceiro; abertura da fila, aprovação, consulta de saldo insuficiente e ausência de POST de estorno. Serviços simulados, não aparelho físico.
- Sintaxe JavaScript, bundle e git diff verificados.

## Implantação

O usuário autorizou expressamente a publicação no repositório público `edolbf-collab/tamo-on` e no Marketplace de testes. O envio pelo Git local não dispõe de credencial; a publicação usa a integração autenticada do GitHub, com verificação do commit de origem.

- Migração aplicada: `20261105195559_admin_refund_review.sql`, somente em `owybghlwcohfyapvsfdo`.
- Função `asaas-refund`: versão 13, com autenticação interna e `verify_jwt=false` já existente.
- Teste SQL executado novamente após implantação, com rollback das fixtures, aprovado.
- `real_money_enabled=false` e `notification_emails=false` confirmados.
- As tabelas privadas novas têm RLS sem políticas de acesso direto, intencionalmente, e permissões revogadas. Acesso somente por funções autenticadas e autorizadas. O aviso informativo do advisor sobre RLS sem políticas não significa que as tabelas estejam públicas: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.
- Nenhuma mudança no build iOS 171 enviado à Apple. A interface nativa permanece para a próxima compilação; a Administração pode operar pela web.

O arquivo `incremental.patch` do pacote é aplicável com `git apply --check` / `git apply` sobre a base registrada. Inclui testes e documentação. `codigo/` contém apenas arquivos alterados/adicionados; remoções constam em `arquivos-removidos.txt`.
