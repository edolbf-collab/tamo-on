# Métricas do Marketplace — validação web

Acesso pelo menu **Métricas** da administração e do parceiro. No parceiro exige proprietário ou `manage_finance`; o modo administrativo de visualizar como parceiro permanece restrito ao parceiro selecionado. A API retorna somente agregados e nomes de estabelecimentos, sem participantes, tokens ou evidências financeiras.

## Indicadores

- Ocupação por horas, com intervalos recortados no período e sem duplicar sobreposições. Prioridade: reserva confirmada/concluída, espera de pagamento, bloqueio, livre. Bloqueios não compõem a oferta. Sem agenda, o percentual fica indisponível.
- Espaços comparáveis e dez faixas de dia da semana/hora mais ocupadas, com base de horas exibida.
- Reservas por data de criação, posição atual: confirmadas/concluídas, canceladas/devolvidas, expiradas, pendentes, valor contratado e média. Cancelamentos não incluem expiração sem pagamento.
- Histórico financeiro oficial por data da movimentação: recebimento, devolução, taxas e comissão. Recebido menos devoluções não representa lucro ou saldo disponível.
- Saldo atual a receber e devoluções pendentes das reservas criadas no período, reutilizando `reservation_financial_snapshot`.
- Ocorrências de jogos pela data de início e seu valor alocado; não confundir com data de caixa. Mensais ocupam suas ocorrências, sem multiplicar o valor da reserva inteira.
- Vínculos mensais pelo estado atual e soma dos valores cadastrados dos ativos. Não é promessa de receita futura.
- Organizadores novos/recorrentes por parceiro, usando histórico de reservas hoje confirmadas/concluídas. Cotas e participantes não contam como novos clientes.

Datas inclusivas, fuso America/Sao_Paulo, máximo 366 dias. Comparação com intervalo anterior de igual duração. Histórico recalculado na consulta, sem fotografia histórica de estados anteriores. Filtros de parceiro e espaço afetam todos os indicadores; vínculos mensais explicitamente não são filtrados por data.

## Validação

- Migração `20261113021757_marketplace_metrics.sql`, aplicada no Marketplace `owybghlwcohfyapvsfdo`; sem alterações na Comunidade ou nos registros de teste.
- PGlite: interseção de horários, mensalidade com várias ocorrências, início de mês em Brasília, devoluções, agenda vazia, comparação, isolamento entre parceiros, equipe sem permissão, bloqueio de perfil, usuário anônimo e modo de visualização administrativa.
- 140 testes da administração e integração Marketplace aprovados localmente.
- Consulta autenticada no banco com ambas as quadras fictícias; totais por parceiro conciliam com o consolidado. Consulta anual do agregador: cerca de 144 ms na base de homologação atual (não é garantia de desempenho em escala).
- Prévia visual conferida em desktop e iframe de 390px. Teste de navegador automatizado está em `mobile/tests/admin-metrics-browser.mjs`; o workflow `marketplace-metrics.yml` executa SQL, filtros, erros, respostas atrasadas, troca de conta e larguras 320/390/768/1280.
- Auditoria de segurança após migração: nenhuma ocorrência nova referente às três funções de métricas. Avisos antigos de outras funções não foram alterados por este trabalho.

## Roteiro de aceite

1. Abrir Marketplace → Administração → Métricas. Conferir novembro e outubro, consolidado e cada uma das duas quadras fictícias.
2. Comparar recebimentos/devoluções com Financeiro no mesmo período; jogos podem ter competência diferente do recebimento.
3. Usar Visualizar como parceiro e abrir Métricas; confirmar que só aparece aquele parceiro.
4. Mudar datas e espaço, atualizar, testar um período sem agenda e voltar ao mês atual.
5. Validar no navegador do celular. Nenhuma publicação nas lojas é feita por este workflow.

A futura remoção dos dados fictícios remove-os automaticamente dos agregados. Esta entrega não apaga nem cria reservas, pagamentos, usuários, vínculos ou horários.
