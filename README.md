# Tâmo On — Beta 1.0 Build 159

Aplicativo PWA para organização de grupos esportivos, eventos, confirmações, times, churrasco, caixa e notificações.

## Versões
- Aplicativo, HTML e Service Worker: 159
- Banco: 149
- publish-announcement: 114
- delete-beta-user: 106

## Implantação
Leia `ATUALIZACAO-TAMO-ON-BETA-1.0-BUILD-159.md`.
Esta atualização recupera falhas no envio do aceite, confere se o banco já salvou a confirmação antes de reenviar e registra a versão correta do aplicativo nos novos aceites.

Não há SQL ou Edge Functions a atualizar. A instalação e a ativação jurídica da Build 157 permanecem independentes, conforme `ATUALIZACAO-TAMO-ON-BETA-1.0-BUILD-157.md`. Os documentos, a vigência e os aceites existentes são preservados.

Preserve `supabase-config.js`, os ícones e a estrutura das pastas. Não execute o schema consolidado sobre o banco atual.
