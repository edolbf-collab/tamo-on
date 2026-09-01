# Tâmo On — atualização Beta 1.0 Build 148

## Versões esperadas

- Aplicativo: 148
- HTML: 148
- Service Worker: 148
- Banco: 145
- Edge Functions: 111

## Alterações

- O sino da tela principal mostra um contador vermelho para avisos novos.
- O contador exibe de `1` a `9` e passa para `9+` acima desse total.
- A leitura é individual por usuário e sincronizada pelo banco.
- Ao abrir a Central de avisos, os avisos exibidos são marcados como lidos.
- Avisos anteriores à atualização começam como lidos, evitando um contador artificial na primeira abertura.
- A estrutura de leitura aceita novas origens no futuro, incluindo mensagens do Marketplace.
- A gestão da escala não apresenta mais a opção `Talvez`.
- `Vou` grava o status `confirmed`, usado em confirmados, capacidade e formação dos times.
- `Não vou` grava o status `out`, usado na lista de ausentes.
- Registros legados `maybe` são mostrados como `Sem resposta`, sem apagar outros dados automaticamente.

## Ordem de publicação

1. Confirme que a Build 147 / Banco 144 já está instalada.
2. Execute `backend/backend-migration-beta-1.0-build-148-notification-badge-and-attendance.sql` no SQL Editor.
3. Execute `backend/backend-healthcheck-beta-1.0-build-148.sql` e confirme que todos os resultados são `true`.
4. Extraia o pacote incremental e envie todo o conteúdo para a raiz do GitHub, preservando a pasta `backend`.
5. Aguarde o deployment e confirme no diagnóstico: aplicativo 148, HTML 148, Service Worker 148 e banco 145.

## Arquivos SQL no GitHub

Envie a migration, o healthcheck e o `backend/supabase-schema.sql` ao GitHub dentro da pasta `backend`.

No banco atual, execute somente a migration da Build 148 e depois o healthcheck. O arquivo `backend/supabase-schema.sql` é o esquema consolidado para instalações novas e não deve ser executado no banco existente.

Não há nova Edge Function nesta atualização. A versão permanece 111.
