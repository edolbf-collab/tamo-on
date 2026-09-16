# Tâmo On — Beta 1.0 Build 158

Aplicativo PWA para organização de grupos esportivos, eventos, confirmações, times, churrasco, caixa e notificações.

## Versões
- Aplicativo, HTML e Service Worker: 158
- Banco: 149
- publish-announcement: 114
- delete-beta-user: 106

## Implantação
Leia `ATUALIZACAO-TAMO-ON-BETA-1.0-BUILD-158.md`.
Esta atualização corrige a abertura interna dos avisos, a leitura pelo push e a identificação individual dos reenvios. Publique o incremental e substitua a Edge existente `publish-announcement` pela Build 114.

Não há migration. O healthcheck da Build 158 é somente leitura. A instalação e a ativação jurídica da Build 157 permanecem independentes, conforme `ATUALIZACAO-TAMO-ON-BETA-1.0-BUILD-157.md`; esta atualização não redefine documentos, vigência nem aceites.

Preserve `supabase-config.js`, os ícones e a estrutura das pastas. Não execute o schema consolidado sobre o banco atual.
