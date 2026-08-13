# Tâmo On — Beta 1.0 Build 140

Aplicativo PWA para organização de grupos esportivos, eventos, confirmações, times, churrasco, caixa e notificações.

## Versões
- Frontend: 140
- Banco: 140
- Edge Functions: 110

## Implantação
1. Execute a migration da Build 140 e o healthcheck.
2. Publique `publish-announcement` Build 110.
3. Preserve e migre os valores do `supabase-config.js` conforme `docs/MIGRACAO-CONFIG-BUILD-140.md`.
4. Substitua a árvore atual do aplicativo pela árvore limpa desta build.
5. Feche e reabra o PWA para ativar o novo service worker e limpar caches anteriores.

Consulte `docs/PLANEJAMENTO-MESTRE-TAMO-ON.md` para continuidade do projeto.
