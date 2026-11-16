# Plano por estabelecimento — 14/11/2026

Decisão comercial: R$ 300 mensais por estabelecimento físico (`venues`), com qualquer quantidade de quadras (`venue_spaces`). Cada unidade em endereço diferente tem seu plano, mesmo pertencendo ao mesmo parceiro/CNPJ. Nenhuma mensalidade é calculada pelo número de quadras ou de CNPJs.

Início no dia 01, sem proporcionalidade. Primeira mensalidade integral com vencimento nesse dia; seguintes no sexto dia útil. Calendário adotado: segunda a sexta, excluindo feriados nacionais fixos e datas adicionais revisadas pela administração. O calendário anual deve incluir feriados estaduais, municipais e bancários móveis aplicáveis. Sem revisão do ano, o emissor não cria cobranças daquele ano. A primeira cobrança mantém dia 01 mesmo quando não útil, conforme a regra de início definida. Não há juros, multa, suspensão por atraso posterior ou débito automático em saldo de subconta configurados.

## Carteira inicial

O identificador estável é `marketplace_groups.id`, associado ao estabelecimento. Nome, administrador, horário, quadra interna ou encerramento de vínculo não alteram a classificação. Não se usa origem de aquisição do cliente, data de criação da comunidade ou CPF/CNPJ do organizador como critério. Não se confia no `external_group_id` editável para conceder isenção.

Administração → **Planos e mensalidades**: escolher estabelecimento, preparar início, conferir vínculos importados, selecionar os grupos e revisar calendário. A importação existente continua disponível; o botão de seleção usa os vínculos já importados. O fechamento preserva os pré-vínculos importados ainda pendentes e cria a primeira mensalidade. O aceite dos responsáveis pode ocorrer depois. Grupos já aprovados/importados devem estar selecionados e as alterações do formulário precisam estar salvas. Finalizar o cadastro das importações antes de fechar; importações posteriores não entram na carteira inicial.

Parceiro → **Plano Tâmo On**: consulta com permissão financeira, valores, carteira, vencimentos e cobranças. Modo “visualizar como parceiro” só permite consulta e respeita o parceiro selecionado.

Reservas novas de estabelecimentos com plano pronto recebem fotografia contratual: carteira inicial = 0%; outros grupos/reservas pessoais = 5%. Um grupo inicial em uma unidade não recebe isenção automática em outra. Quadra, parceiro e estabelecimento devem corresponder. Grupo/estabelecimento/taxa são imutáveis após criação; uma nova reserva é necessária para outro grupo. Novas reservas exigem a data de início alcançada e primeira mensalidade paga no ambiente correto. Planos em preparação não modificam a operação de homologação existente. Em produção real, toda nova reserva exige um plano fechado; não há retorno à taxa anterior por falta de configuração. Endereços duplicados do mesmo parceiro são bloqueados na preparação do plano, com comparação de município, UF, número e CEP ou logradouro. Reservas anteriores à ativação preservam condições históricas e não são reprecificadas. Na implantação, revisar reservas de teste/prévias antes de abrir a operação; a limpeza dos dados fictícios continua uma tarefa separada.

O split e o financeiro existentes já consultam `finance_commission_rate`. O gatilho atribui 0 ou 5 no servidor e não aceita a taxa enviada pelo cliente. Mensalidade não entra em GMV, cotas ou repasses de reservas. Comunidade não sofreu migração.

## Emissão Asaas

A documentação oficial permite mensalidades controladas pela aplicação: https://docs.asaas.com/docs/guia-de-cobrancas. Assinaturas recebem uma primeira data e ciclo mensal, sem parâmetro documentado para sexto dia útil: https://docs.asaas.com/reference/criar-nova-assinatura. Portanto, calcular vencimentos no Tâmo On e emitir cobranças individuais com `externalReference` estável por estabelecimento/competência.

O parceiro é cadastrado como **cliente da conta principal**; não se cobra diretamente o identificador da subconta nem se retira saldo dela. Um cliente/CNPJ pode ter várias cobranças de estabelecimentos diferentes. Pix é o meio preparado inicialmente. A cobrança fica disponível pelo link retornado pelo Asaas, sem envio automático de mensagens nesta implantação.

`establishment-billing` é o emissor e conciliador, **ativo em Sandbox na web 174-R6**. Usa chave da conta principal, valida carteira (`/wallets`), cria/localiza cliente pela referência estável do parceiro e confere seu documento. O cliente mantém notificações automáticas desabilitadas. Registra uma cobrança por estabelecimento/mês. Não usa split nem transferência. Reexecução busca referência antes de criar. POST com resultado incerto permanece em conferência; não é reenviado automaticamente mesmo quando busca imediata não encontra resultado. A conciliação lê o estado atual no Asaas (evita eventos fora de ordem). A primeira obrigação Sandbox pode ser emitida antecipadamente, com vencimento preservado no dia de início. Mensalidades recorrentes continuam limitadas ao mês corrente ou anterior. Cobranças posteriores não são multiplicadas por visitas à tela.

Uma falha na consulta de uma cobrança é registrada sem interromper as demais. Consultas incompletas ou paginadas não comprovam ausência/unicidade e impedem novos POSTs. A fila de conciliação avança mesmo com um registro pendente de conferência. Juros e multa são enviados explicitamente como zero para impedir que configurações globais da conta acrescentem encargos não definidos.

Sandbox e produção têm obrigações separadas por estabelecimento/competência/ambiente. O histórico de simulação é preservado e nunca quita a obrigação de produção. O emissor seleciona somente o ambiente configurado. A passagem de testes para lançamento deve incluir revisão da data de início e dos dados de teste; não há conversão automática de mensalidades de teste em pagamentos reais.

Para a ativação posterior em produção (separada desta homologação):

1. Confirmar conta principal, documento do parceiro e capacidade de emissão em Sandbox, depois produção.
2. Configurar no servidor `ESTABLISHMENT_BILLING_MAIN_API_KEY`, `ESTABLISHMENT_BILLING_MAIN_WALLET_ID`, `ESTABLISHMENT_BILLING_ENVIRONMENT`, `ESTABLISHMENT_BILLING_JOB_SECRET` e `ESTABLISHMENT_BILLING_ENABLED=true`. Nunca fornecer chave de subconta.
3. Revisar o emissor para produção e manter autenticação de servidor. O agendamento atual executa somente Sandbox, a cada cinco minutos, pelo segredo já existente no Vault; não ativa dinheiro real.
4. Validar emissão, pagamento, atualização, timeout, duplicidade e devolução com movimentação pequena. Depois habilitar produção conforme o lançamento do Marketplace. Pagamento Sandbox/simulado não libera operação real.

As tabelas são privadas com RLS, sem acesso direto do navegador. RPCs têm validação de perfil/admin/parceiro e escopo; funções do emissor são exclusivas de `service_role`. Auditoria registra preparação, carteira congelada, calendário e conciliação. Uma obrigação tem chave única estabelecimento/competência/ambiente.

## Validação

`mobile/tests/admin-commercial.test.mjs`: SQL real em PostgreSQL/PGlite, 0/5%, várias quadras e unidades, retomada de vínculo, histórico, isolamento, perfil bloqueado, preview, vencimentos, feriados, primeira mensalidade, separação de ambientes, repetição e integridade de retorno do provedor.

`admin-commercial-provider.test.mjs`: payload conta principal, reutilização de cliente/referência e timeout sem duplicação. `admin-commercial-browser.mjs`: 320/390/768/1280 px, permissões, confirmação da carteira, erros e troca de identidade. Workflow `establishment-plans.yml` executa os testes e publica capturas de validação. A emissão real na conta Asaas não foi testada por estes testes internos.

## Implantação web 174-R2 — 15/11/2026

A migration `establishment_commercial_plans` foi aplicada no Marketplace Staging (`owybghlwcohfyapvsfdo`) e registrada pelo servidor como `20261115150144`. As quatro tabelas privadas estão com RLS e sem acesso direto de `anon` ou `authenticated`; as RPCs administrativas exigem identidade e autorização, e as três RPCs do emissor permitem apenas `service_role`. A consulta autenticada do administrador foi validada no banco remoto, com `test_mode=true`, sem criar planos ou cobranças.

Foram aprovados 151 testes locais, a verificação Deno e os seis workflows de validação da PR #24, incluindo o navegador nas quatro larguras previstas. Os vencimentos remotos conferidos foram 01/12/2026 para o início, 11/01/2027 para a recorrência de janeiro e 10/02/2027 ao excluir os dias 08 e 09 do calendário de fevereiro.

Esta versão publica a interface web de testes e o banco necessário à simulação. `real_money_enabled` permanece falso. O emissor Asaas está preparado no repositório, mas sua implantação, credenciais e agendamento ficam para a homologação da conta principal; nenhuma cobrança real foi emitida. A publicação nas lojas permanece uma etapa posterior.

## Financeiro e checkout da mensalidade — web 174-R3

Financeiro → **Mensalidades Tâmo On** apresenta totais e histórico por competência, estabelecimento, situação e ambiente. Vencidas são parte do total em aberto; pagamentos cancelados/devolvidos não integram o total pago. Datas de pagamento são exibidas em Brasília. Histórico de simulação não se mistura com produção nem com comissões/GMV das reservas. O menu dos planos oferece acesso direto a esta área. A visualização como parceiro permite somente leitura.

O botão **Pagar mensalidade** consulta `establishment-checkout`. Por padrão, sem habilitação do emissor, oferece apenas simulação explícita para obrigações Sandbox ainda não emitidas. Não apresenta QR Code ou payload fictícios. A simulação exige confirmação, registra método e data no histórico e não movimenta saldo. Registros com emissão/tentativa real no Sandbox não podem receber baixa simulada.

O checkout suporta a emissão individual na conta principal, consulta do QR Code dinâmico/Copia e Cola da mesma cobrança e conciliação por consulta autenticada ao Asaas. Exige plano e calendário revisados; a R6 também permite preparar a primeira cobrança Sandbox antes do início. Enquanto a janela está aberta, consulta a cada 20 segundos; **Atualizar mensalidades** reconcilia cobranças já emitidas do estabelecimento/mês selecionados. O recebimento confirmado na conta principal é a evidência para a baixa. A resposta ao pedido de débito na subconta não quita a mensalidade. Na R6, o emissor agendado faz conciliação Sandbox a cada cinco minutos, inclusive sem navegador aberto.

A integração desta etapa é restrita por código ao Sandbox, além das flags e da configuração do banco. Nenhuma credencial, flag financeira ou cron é alterado por esta entrega. Para homologar com o provedor, configurar no servidor:

- `ESTABLISHMENT_CHECKOUT_ENABLED=true`, `ESTABLISHMENT_BILLING_ENVIRONMENT=sandbox`, `ESTABLISHMENT_BILLING_MAIN_API_KEY` e `ESTABLISHMENT_BILLING_MAIN_WALLET_ID` da conta principal Sandbox.
- Para débito comandado pelo parceiro: `ESTABLISHMENT_BALANCE_ENABLED=true` e `ESTABLISHMENT_BILLING_SANDBOX_ACCOUNTS`, uma lista privada de `{partnerId, accountId, walletId, apiKey, active}`. Validam-se vínculo da subconta, carteiras de origem/destino e saldo disponível; nenhuma chave é retornada ao cliente.
- Configurar as autorizações de saída exigidas pelo Asaas antes do teste de débito, conforme https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks. A integração acompanha operações pendentes; não desativa nem aprova automaticamente esses controles.

O saldo exige confirmação explícita por responsável financeiro do parceiro; administrador e modo de visualização não podem comandar o débito. Uma tentativa persistida por mensalidade impede reenvios concorrentes/cegos. Timeout ou falha depois do envio fica em conferência e requer conciliação; não existe repetição automática. Sessão revogada, perfil bloqueado, parceiro sem permissão, ambiente diferente e IDs de terceiros são rejeitados no servidor. O identificador e o valor da cobrança vêm do banco; o navegador não define destinatário, QR Code ou valor do débito.

Antes do lançamento: homologar as duas contas Sandbox, QR dinâmico, pagamento externo, débito com saldo, saldo insuficiente, autorização de saída, recebimento, devolução e resultado incerto; então revisar a ativação de produção separadamente. Os testes automatizados usam SQL real/PGlite e respostas controladas do provedor; não comprovam habilitação da conta Asaas.

Implantação de homologação em 16/11/2026: migration `establishment_monthly_checkout` aplicada no Marketplace Staging como `20261116123128`; `establishment-checkout` versão 1 ativa com autenticação própria por Supabase Auth e autorização no banco. A consulta administrativa foi validada remotamente e chamada sem autenticação retorna HTTP 401. RLS/permissões conferidos; `real_money_enabled=false`. Nenhuma credencial Asaas, configuração de cobrança ou dado de plano/mensalidade foi criado para verificar a implantação. Os 160 testes locais e a suíte de navegador de mensalidades passaram.

## Fechamento com associações pendentes — web 174-R4

O fechamento registra uma fotografia dos importados ativos por ID da entrada e estabelecimento, com nome e horário originais. A tela lista esses registros antes da confirmação e mantém sua consulta após o fechamento. Uma entrada protegida não bloqueia a primeira mensalidade e permanece protegida: não há aceite ou exclusão automáticos.

Quando o responsável aceita posteriormente, o gatilho transfere a classificação para o ID permanente do grupo antes de criar as reservas mensais nativas. A operação é atômica: falha no aceite desfaz a classificação. Registros importados depois do fechamento não recebem a isenção; repetir o fechamento não amplia a carteira nem duplica a cobrança. Uma entrada liberada sem aceite permanece no histórico e não pode ser reutilizada para conceder isenção a outro grupo. A classificação já atribuída e as taxas das reservas históricas são preservadas. Não há inclusão retroativa para planos fechados antes desta migration.

O fechamento usa a mesma ordem de bloqueios do fluxo de importação/aceite antes de bloquear o plano, garantindo o marco temporal com importações concorrentes. A fotografia não bloqueia por FK a entrada de origem, pois a aprovação bloqueia essa entrada antes de atualizá-la; o gatilho protege identidade e exclusão. A tabela permanece privada, com RLS e sem permissões de leitura/escrita para anon/authenticated. RPCs preservam o escopo administrativo/financeiro existente.

Validação ampliada: fechamento com pendências, primeira cobrança única, aceite posterior a 0%, isolamento por estabelecimento, importação posterior a 5%, cancelamento de pré-vínculo, repetição, rollback do aceite e preservação do histórico. A interface exibe retorno de sucesso e leva as mensagens de erro para a área visível.

Migration aplicada em 16/11/2026 no Marketplace Staging como `20261116171950`. A validação remota executou o fechamento da Arena de homologação dentro de transação revertida: plano pronto, uma mensalidade e o pré-vínculo ainda protegido/sem grupo. Após rollback, confirmado plano em preparação, zero novas cobranças/fotografias e dinheiro real desativado. O fechamento definitivo permanece disponível na interface para o teste do usuário. RLS ativo, sem acesso direto do navegador; nenhum novo aviso de segurança além do informativo esperado de tabela privada sem políticas de acesso direto.

## Pagamento iniciado pelo parceiro — web 174-R5

A Administração prepara o plano, fecha a carteira e acompanha a cobrança. O botão administrativo de simular a primeira quitação foi removido e a RPC antiga recusa a operação, inclusive para clientes que mantiverem a versão anterior aberta. No Financeiro, somente a conta do parceiro com permissão financeira acessa o pagamento/simulação; administradores e o modo de visualização não oferecem essa ação. A RPC de simulação também rejeita administradores antes de qualquer baixa ou retorno idempotente. A conciliação de recebimentos do provedor permanece disponível à Administração.

A mensalidade de homologação baixada pelo atalho antigo foi reaberta após conferir a simulação identificada, sem emissão, cliente Asaas ou tentativa de débito. A correção preserva o ID/competência da obrigação, o fechamento da carteira, os pré-vínculos e a auditoria anterior; acrescenta um registro do desfazimento. Não existe reabertura automática de outras mensalidades.

A confirmação simulada permanece disponível ao parceiro no ambiente de teste e exige confirmação explícita. Isso não ativa a emissão Asaas: QR Code, Copia e Cola e débito na subconta continuam condicionados à configuração e homologação das contas Sandbox.

Migration aplicada no Marketplace Staging em 16/11/2026 como `20261116173823`. A obrigação identificada voltou a `planned`, com carteira `ready` e o pré-vínculo preservado. A auditoria contém tanto `first_payment_simulated` quanto `admin_simulation_reopened`. Nenhuma flag financeira foi ativada. Os 160 testes e build/check locais passaram.


## Pix Asaas integrado — web 174-R6

O checkout usa a configuração Sandbox da conta principal já validada para as reservas, mantendo chaves exclusivamente no servidor. Configuração específica/opt-out explícito prevalece. A carteira recebedora é conferida pelo Asaas a cada operação; nenhuma chave de subconta emite recebíveis do Tâmo On. Para parceiros vinculados ao registro privado de subcontas, nome/documento vêm do cadastro da subconta confirmado pela conta principal. Um cliente por parceiro usa `tamoon-partner:<id>` e `notificationDisabled=true`, com conferência de documento/referência antes de reutilização. Estabelecimentos diferentes continuam com cobranças separadas.

O Pix dinâmico vem de `/payments/<id>/pixQrCode`: imagem PNG, payload Copia e Cola e validade. A cobrança é validada por referência, cliente, valor e vencimento; não há split, juros ou multa. A emissão inicial antecipada existe apenas em Sandbox e preserva o vencimento dia 01. Competências futuras recorrentes continuam bloqueadas. O parceiro consulta a confirmação na janela de pagamento; Administração acompanha no Financeiro. Débito de saldo permanece desabilitado nesta etapa.

A conciliação de servidor usa `marketplace_monthly_cron_secret` do Vault, sem leitura da credencial pelo navegador, e agenda `tamoon-establishment-pix-sandbox` a cada cinco minutos. A função privada não pode ser executada por anon/authenticated e retorna sem emitir quando dinheiro real é habilitado. POST incerto continua retido para conferência, sem repetição automática.

Em 16/11/2026 foram confirmadas a carteira principal Sandbox e uma chave Pix ativa. A simulação do parceiro foi preservada na auditoria; a mesma obrigação de R$ 300,00, vencimento 01/12/2026, foi preparada para a etapa Asaas. Cobrança `pay_0_3u3e59p8lleemr` criada no Sandbox com estado PENDING; QR Code e payload retornados e validados, sem pagamento/debito executado. Conciliação posterior confirmou uma cobrança, sem nova emissão ou item em conferência. `real_money_enabled=false`.

Migrations aplicadas no Marketplace Staging como `20261116182043` (emissão inicial Sandbox) e `20261116182246` (conciliação agendada). Os cartões Pagas/Em aberto/Vencidas usam `.stat`, o mesmo contorno, raio e fundo dos demais indicadores; o módulo é compartilhado por Administração e parceiro. Validação local: 166 testes aprovados, incluindo isolamento da identidade, notificações desabilitadas, opt-out, emissão inicial e bloqueio de competência futura recorrente. Capturas de navegador cobrem as duas contas, temas claro/escuro e quatro larguras.

## Webhook de mensalidade e atualização da tela — web 174-R7

O primeiro teste de baixa confirmou uma lacuna: `asaas-webhook` v19 classificava a cobrança `tamoon-plan:` como pagamento de reserva, gerava `ASAAS_PAYMENT_UNLINKED` e devolvia HTTP 503. O parceiro havia atualizado pela consulta automática de 20 segundos do checkout; a baixa no banco não demonstrava que o webhook tinha sido processado. O e-mail de 16/11/2026 às 16h02 (Brasília) corresponde a essa falha.

O receptor e o processador administrativo agora encaminham mensalidades antes da classificação de reservas. A nova RPC exclusiva de `service_role` encontra a obrigação pelo identificador/referência e confere valor, vencimento, cliente e ambiente. A função confere a conta principal e consulta o estado atual diretamente no Asaas, evitando aplicar payload antigo fora de ordem. Reservas, Pix externos, splits e devoluções mantêm seus encaminhamentos. O leitor de evidências de devolução usado no webhook v19 foi preservado em módulo próprio, sem alterar a operação de devoluções publicada separadamente.

O evento que falhou foi reprocessado por comando de servidor autenticado; passou para `processed`, sem erro, mantendo a mesma cobrança paga e o horário original de baixa. O Asaas reenviou o evento e recebeu HTTP 200 às 16h12m51s. Sua configuração de webhook permaneceu ativa, com fila não interrompida. Não houve nova cobrança, débito ou pagamento. A migration foi aplicada como `20261116191036`; `asaas-webhook` v20 e `webhook-processor` v21 foram implantados. `establishment-billing` v5 oferece consulta restrita da saúde do webhook e reprocessamento somente de eventos de mensalidades já recebidos.

Financeiro → Mensalidades Tâmo On agora consulta os dados atualizados a cada dez segundos enquanto a tela está visível, na Administração e no parceiro. Atualiza lista e totais sem recarregar a página; conserva filtros, pausa em abas ocultas e retoma ao voltar. Não interfere no checkout aberto ou em filtros em edição. Troca de conta, saída da tela e respostas atrasadas interrompem/descartam a consulta. Falha transitória mantém os últimos dados exibidos; revogação de acesso remove o conteúdo.

A atualização da tela é uma consulta periódica autenticada, não uma assinatura Supabase Realtime de tabelas privadas. As tabelas de mensalidades continuam sem leitura direta pelo navegador. O webhook atualiza o banco; a tela acompanha essa atualização, e a conciliação de cinco minutos continua como contingência.

Validação: testes de roteamento, conta divergente, referência/valor/cliente/vencimento divergentes, resposta atual versus evento antigo, falha do Asaas, reenvio autenticado e isolamento de reservas. Teste de navegador acompanha a mudança para paga sem clique, totais/filtros, retorno de aba, checkout aberto, falha transitória e troca de conta.
