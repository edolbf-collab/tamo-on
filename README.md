# Tâmo On — Beta 1.0 Build 157

Aplicativo PWA para organização de grupos esportivos, eventos, confirmações, times, churrasco, caixa e notificações.

## Versões
- Aplicativo, HTML e Service Worker: 157
- Banco: 149
- publish-announcement: 113
- delete-beta-user: 106

## Implantação
Leia `ATUALIZACAO-TAMO-ON-BETA-1.0-BUILD-157.md`.
Esta atualização instala documentos v1.2, aceite versionado e confirmação expressa de 18 anos ou mais. A exigência fica preparada e depende de ativação após definição da vigência, publicação do aplicativo e atualização das duas Edge Functions.

Preserve `supabase-config.js`, os ícones e a estrutura das pastas. No banco atual execute a migration incremental e o healthcheck; não execute o schema consolidado.
