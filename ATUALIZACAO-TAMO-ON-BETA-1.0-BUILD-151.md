# Tâmo On — atualização incremental da Build 151

## Versões esperadas

- Aplicativo: 151
- HTML: 151
- Service Worker: 151
- Banco: 148
- Edge Function `publish-announcement`: 112, sem alteração nesta build

## Ordem de publicação

1. Execute no SQL Editor somente `backend/backend-migration-beta-1.0-build-151-notification-retention-and-read-rules.sql`.
2. Execute `backend/backend-healthcheck-beta-1.0-build-151.sql` e confirme que todos os resultados são `true`.
3. Extraia o pacote incremental e envie todo o conteúdo para a raiz do GitHub, preservando as pastas.
4. Aguarde o deployment e confirme as versões no diagnóstico do aplicativo.

O arquivo `backend/supabase-schema.sql` deve ser atualizado no GitHub, mas não executado sobre o banco atual. A migration cria e agenda a rotina diária por meio da extensão `pg_cron`; não há Edge Function nova.

## Leitura das notificações

Exigem clique no cartão:

- aviso do grupo;
- aviso reenviado;
- novo evento;
- lembrete de confirmação;
- nova cobrança;
- mensagem do sistema;
- qualquer tipo futuro ou desconhecido.

São baixadas automaticamente ao abrir o sino:

- presença confirmada (`Vou`);
- alteração de presença (`Não vou`).

O banco registra `clicked`, `notification_center_opened` ou `legacy`. Abrir a Central não é tratado como prova de leitura do conteúdo.

## Retenção

- Notificações aparecem por 90 dias e permanecem no banco por 180 dias.
- Avisos do grupo aparecem por 12 meses e permanecem no banco por até 24 meses.
- Tentativas técnicas de push permanecem por 180 dias.
- Assinaturas de push desativadas ou inválidas são eliminadas após 30 dias.
- Preservações excepcionais impedem a exclusão até a data formalizada.
- A limpeza ocorre diariamente às 03:17 UTC e registra apenas os totais eliminados.

## Teste da leitura híbrida

1. Gere um aviso do grupo, um novo evento, um lembrete, uma cobrança ou uma mensagem do sistema.
2. Abra o sino e confirme que o contador desses avisos não desaparece.
3. Clique em cada cartão e confirme a redução do contador.
4. Gere uma confirmação `Vou` e uma alteração `Não vou` por outro membro.
5. Abra o sino e confirme que somente esses dois tipos são baixados automaticamente.
6. Feche e reabra a Central e confirme que os tipos que exigem clique continuam marcados como novos.

## Verificação da rotina

O healthcheck confirma a existência e a ativação do agendamento. Para consultar as últimas execuções sem alterar dados:

```sql
select ran_at, result
from public.data_retention_runs
order by ran_at desc
limit 20;
```

Não execute manualmente a função de limpeza durante os testes funcionais. O primeiro ciclo automático ocorrerá no horário agendado.
