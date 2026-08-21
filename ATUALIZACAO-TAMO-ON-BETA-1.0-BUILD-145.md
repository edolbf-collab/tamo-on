# Tâmo On Beta 1.0 — Build 145

## Identificação da versão

- Aplicativo: Build 145
- HTML: Build 145
- Service Worker: Build 145
- Banco de dados: Build 142
- Edge Functions: Build 111, sem alteração nesta atualização

## Alterações incluídas

### Duração dos eventos

O agendamento agora exige a duração total, em minutos, entre 15 e 480 minutos. O aplicativo mostra o intervalo completo do evento.

Exemplo:

- Início: 18:00
- Duração: 60 minutos
- Horário exibido: 18:00 às 19:00

Eventos antigos recebem automaticamente a duração padrão de 60 minutos. A duração também pode ser alterada em `Editar evento`, desde que ele ainda não tenha começado.

### Encerramento e histórico

As confirmações de presença, alterações do evento e demais respostas continuam sendo encerradas no horário de início.

A separação e o rebalanceamento dos times permanecem disponíveis durante a primeira metade da duração. Ao atingir 50% do tempo, o evento é encerrado operacionalmente e passa para o histórico.

No exemplo de 18:00 às 19:00:

- Respostas e edição fecham às 18:00.
- Separação dos times permanece disponível até 18:30.
- Às 18:30, o evento passa para o histórico.

O aplicativo verifica essa mudança automaticamente a cada 30 segundos. A função do banco também aplica o limite, impedindo chamadas fora da janela permitida.

### Caixa — pagamentos em lote

- A identificação dos pagamentos inicia em branco.
- O preenchimento não é obrigatório.
- Quando permanece em branco, cada pagamento recebe a descrição da cobrança à qual está vinculado.
- As formas disponíveis no lote são somente Pix, Dinheiro e Cartão.
- Transferência foi retirada do formulário e bloqueada na função de pagamentos em lote.
- A operação continua transacional: se uma baixa falhar, nenhuma baixa do lote é concluída.

## Ordem de publicação

1. No Supabase, abra o SQL Editor.
2. Execute integralmente `backend/backend-migration-beta-1.0-build-145-event-duration-and-batch-payments.sql`.
3. Confirme que a execução terminou sem erro.
4. No GitHub, envie todo o conteúdo do pacote da Build 145 para a raiz do repositório, preservando a estrutura das pastas.
5. Aguarde o Cloudflare concluir o deployment da branch `main`.
6. Abra o aplicativo e toque em `Verificar atualização`, se necessário.
7. Em `Sobre e diagnóstico`, confirme: aplicativo 145, HTML 145, Service Worker 145 e banco 142.

## Verificação funcional sugerida

1. Crie um evento curto de teste com início futuro e duração de 60 minutos.
2. Confirme se o app exibe o horário de início e término.
3. Após o início, confirme que as respostas foram fechadas e que a aba Times permanece operacional.
4. Após o marco de 50%, confirme que o evento aparece no histórico e não aceita nova separação.
5. Crie duas cobranças com descrições diferentes e membros vinculados.
6. Use `Caixa > Baixar em lote`, deixe a identificação vazia e faça as duas baixas.
7. Confirme que cada entrada recebeu a descrição da sua própria cobrança.

## Arquivos de infraestrutura

- SQL: `backend/backend-migration-beta-1.0-build-145-event-duration-and-batch-payments.sql`
- Edge Function: nenhuma nesta atualização

