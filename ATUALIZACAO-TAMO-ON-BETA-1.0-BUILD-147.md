# Tâmo On — atualização Beta 1.0 Build 147

## Versões esperadas

- Aplicativo: 147
- HTML: 147
- Service Worker: 147
- Banco: 144
- Edge Functions: 111

## Alterações

- O convidado pode ser excluído normalmente antes do início do evento.
- A exclusão fica bloqueada do início até o horário final do evento, calculado pela duração cadastrada.
- Depois do evento, o registro sai da lista de gerenciamento de convidados, sem apagar sua participação, presença ou time no histórico da partida.
- Os dados históricos continuam sem edição.
- Ao fechar os detalhes, a edição ou o convite recorrente, o aplicativo retorna à tela de Convidados.

## Ordem de publicação

1. No SQL Editor do Supabase, execute somente `backend/backend-migration-beta-1.0-build-147-guest-history-removal.sql`.
2. Execute `backend/backend-healthcheck-beta-1.0-build-147.sql` e confirme que todos os resultados são `true`.
3. Extraia o pacote incremental e envie todo o conteúdo para a raiz do repositório, preservando a pasta `backend`.
4. Aguarde o deployment e confirme no diagnóstico: aplicativo 147, HTML 147, Service Worker 147 e banco 144.

## Arquivos SQL no GitHub

Os SQLs das Builds 146 e 147 incluídos no pacote devem ser enviados ao GitHub dentro da pasta `backend`, para manter o histórico das atualizações. Como a migration da Build 146 já foi executada no banco, não é necessário executá-la novamente.

O arquivo `backend/supabase-schema.sql` é o esquema consolidado de referência para instalações novas. Ele deve ser enviado ao GitHub, mas não deve ser executado no banco atual.

Não há nova Edge Function nesta atualização. A versão permanece 111.
