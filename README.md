# Tâmo On — Beta 1.0 Build 151

Aplicativo PWA para organização de grupos esportivos, eventos, confirmações, times, churrasco, caixa e notificações.

## Versões
- Frontend: 151
- Banco: 148
- Edge Functions: 112

## Implantação
1. Execute a migration da Build 151 no banco existente.
2. Execute o healthcheck da Build 151 e confirme que todos os resultados são `true`.
3. A Edge Function permanece na Build 112 e não precisa ser republicada nesta atualização.
4. Preserve os valores existentes do `supabase-config.js`.
5. Substitua no GitHub os arquivos do pacote incremental, preservando a estrutura das pastas.
6. Feche e reabra o PWA para ativar o novo service worker e limpar caches anteriores.

Consulte `docs/PLANEJAMENTO-MESTRE-TAMO-ON.md` para continuidade do projeto.
