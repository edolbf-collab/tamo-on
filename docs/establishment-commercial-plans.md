# Plano por estabelecimento — 14/11/2026

Decisão comercial: R$ 300 mensais por estabelecimento físico (`venues`), com qualquer quantidade de quadras (`venue_spaces`). Cada unidade em endereço diferente tem seu plano, mesmo pertencendo ao mesmo parceiro/CNPJ. Nenhuma mensalidade é calculada pelo número de quadras ou de CNPJs.

Início no dia 01, sem proporcionalidade. Primeira mensalidade integral com vencimento nesse dia; seguintes no sexto dia útil. Calendário adotado: segunda a sexta, excluindo feriados nacionais fixos e datas adicionais revisadas pela administração. O calendário anual deve incluir feriados estaduais, municipais e bancários móveis aplicáveis. Sem revisão do ano, o emissor não cria cobranças daquele ano. A primeira cobrança mantém dia 01 mesmo quando não útil, conforme a regra de início definida. Não há juros, multa, suspensão por atraso posterior ou débito automático em saldo de subconta configurados.

## Carteira inicial

O identificador estável é `marketplace_groups.id`, associado ao estabelecimento. Nome, administrador, horário, quadra interna ou encerramento de vínculo não alteram a classificação. Não se usa origem de aquisição do cliente, data de criação da comunidade ou CPF/CNPJ do organizador como critério. Não se confia no `external_group_id` editável para conceder isenção.

Administração → **Planos e mensalidades**: escolher estabelecimento, preparar início, conferir vínculos importados, selecionar os grupos e revisar calendário. A importação existente continua disponível; o botão de seleção usa os vínculos já importados. Fechamento bloqueado enquanto há entradas protegidas sem associação confirmada, grupos aprovados/importados ausentes da carteira ou alterações do formulário ainda não salvas. A carteira fica congelada ao confirmar o fechamento. Finalizar a importação antes de fechar; correções posteriores exigem um procedimento administrativo auditado específico, ainda não exposto.

Parceiro → **Plano Tâmo On**: consulta com permissão financeira, valores, carteira, vencimentos e cobranças. Modo “visualizar como parceiro” só permite consulta e respeita o parceiro selecionado.

Reservas novas de estabelecimentos com plano pronto recebem fotografia contratual: carteira inicial = 0%; outros grupos/reservas pessoais = 5%. Um grupo inicial em uma unidade não recebe isenção automática em outra. Quadra, parceiro e estabelecimento devem corresponder. Grupo/estabelecimento/taxa são imutáveis após criação; uma nova reserva é necessária para outro grupo. Novas reservas exigem a data de início alcançada e primeira mensalidade paga no ambiente correto. Planos em preparação não modificam a operação de homologação existente. Em produção real, toda nova reserva exige um plano fechado; não há retorno à taxa anterior por falta de configuração. Endereços duplicados do mesmo parceiro são bloqueados na preparação do plano, com comparação de município, UF, número e CEP ou logradouro. Reservas anteriores à ativação preservam condições históricas e não são reprecificadas. Na implantação, revisar reservas de teste/prévias antes de abrir a operação; a limpeza dos dados fictícios continua uma tarefa separada.

O split e o financeiro existentes já consultam `finance_commission_rate`. O gatilho atribui 0 ou 5 no servidor e não aceita a taxa enviada pelo cliente. Mensalidade não entra em GMV, cotas ou repasses de reservas. Comunidade não sofreu migração.

## Emissão Asaas

A documentação oficial permite mensalidades controladas pela aplicação: https://docs.asaas.com/docs/guia-de-cobrancas. Assinaturas recebem uma primeira data e ciclo mensal, sem parâmetro documentado para sexto dia útil: https://docs.asaas.com/reference/criar-nova-assinatura. Portanto, calcular vencimentos no Tâmo On e emitir cobranças individuais com `externalReference` estável por estabelecimento/competência.

O parceiro é cadastrado como **cliente da conta principal**; não se cobra diretamente o identificador da subconta nem se retira saldo dela. Um cliente/CNPJ pode ter várias cobranças de estabelecimentos diferentes. Pix é o meio preparado inicialmente. A cobrança fica disponível pelo link retornado pelo Asaas, sem envio automático de mensagens nesta implantação.

`establishment-billing` é o emissor e conciliador preparado, **desabilitado até validação da conta emissora**. Usa chave exclusiva da conta principal, valida carteira (`/wallets`), cria/localiza cliente pelo documento e registra uma cobrança por estabelecimento/mês. Não usa split nem transferência. Reexecução busca referência antes de criar. POST com resultado incerto permanece em conferência; não é reenviado automaticamente mesmo quando busca imediata não encontra resultado. A conciliação lê o estado atual no Asaas (evita eventos fora de ordem). Obrigações iniciais futuras só são emitidas no mês de início. Cobranças posteriores não são multiplicadas por visitas à tela.

Uma falha na consulta de uma cobrança é registrada sem interromper as demais. Consultas incompletas ou paginadas não comprovam ausência/unicidade e impedem novos POSTs. A fila de conciliação avança mesmo com um registro pendente de conferência. Juros e multa são enviados explicitamente como zero para impedir que configurações globais da conta acrescentem encargos não definidos.

Sandbox e produção têm obrigações separadas por estabelecimento/competência/ambiente. O histórico de simulação é preservado e nunca quita a obrigação de produção. O emissor seleciona somente o ambiente configurado. A passagem de testes para lançamento deve incluir revisão da data de início e dos dados de teste; não há conversão automática de mensalidades de teste em pagamentos reais.

Para habilitar após homologação:

1. Confirmar conta principal, documento do parceiro e capacidade de emissão em Sandbox, depois produção.
2. Configurar no servidor `ESTABLISHMENT_BILLING_MAIN_API_KEY`, `ESTABLISHMENT_BILLING_MAIN_WALLET_ID`, `ESTABLISHMENT_BILLING_ENVIRONMENT`, `ESTABLISHMENT_BILLING_JOB_SECRET` e `ESTABLISHMENT_BILLING_ENABLED=true`. Nunca fornecer chave de subconta.
3. Agendar chamada autenticada POST à função com `x-billing-job-secret`, por exemplo a cada hora, e monitorar resultados/itens em conferência. O agendamento e a emissão real **não estão ativados** nesta entrega. O botão de teste apenas simula a primeira mensalidade em ambiente com dinheiro real desativado.
4. Validar emissão, pagamento, atualização, timeout, duplicidade e devolução com movimentação pequena. Depois habilitar produção conforme o lançamento do Marketplace. Pagamento Sandbox/simulado não libera operação real.

As tabelas são privadas com RLS, sem acesso direto do navegador. RPCs têm validação de perfil/admin/parceiro e escopo; funções do emissor são exclusivas de `service_role`. Auditoria registra preparação, carteira congelada, calendário e conciliação. Uma obrigação tem chave única estabelecimento/competência/ambiente.

## Validação

`mobile/tests/admin-commercial.test.mjs`: SQL real em PostgreSQL/PGlite, 0/5%, várias quadras e unidades, retomada de vínculo, histórico, isolamento, perfil bloqueado, preview, vencimentos, feriados, primeira mensalidade, separação de ambientes, repetição e integridade de retorno do provedor.

`admin-commercial-provider.test.mjs`: payload conta principal, reutilização de cliente/referência e timeout sem duplicação. `admin-commercial-browser.mjs`: 320/390/768/1280 px, permissões, confirmação da carteira, erros e troca de identidade. Workflow `establishment-plans.yml` executa os testes e publica capturas de validação. A emissão real na conta Asaas não foi testada por estes testes internos.

Continuação de 14/11/2026: retomada do commit `7ed54b4` na branch `work/establishment-plans-20261114`. A consulta somente de estrutura do Marketplace Staging confirmou as colunas e dependências utilizadas; a tabela de planos ainda não estava implantada. A migration desta branch continua inédita no banco remoto. Não houve publicação, alteração de dados remotos ou emissão de cobranças nesta revisão.
