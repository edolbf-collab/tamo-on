# Tâmo On — Beta 1.0 Build 166-R4

Comunidade PWA e aplicativo Android para grupos esportivos, jogos, presença, times, churrasco e caixa. A build 166-R2 inclui o piloto privado do Marketplace C39-R1, conectado exclusivamente ao grupo Teste FC.

## Versões

| Componente | Versão |
| --- | --- |
| Web, HTML e Service Worker | 166 / revisão 166-R4 |
| Android | `1.0.166` / código `166`, derivado de `version.json` |
| Banco da Comunidade | 151 |
| publish-announcement | 115 |
| delete-beta-user | 106 |

`version.json` é a origem do número da versão Android. A compilação verifica que `app.js`, `index.html` e `service-worker.js` usam o mesmo número e falha se encontrar divergência. O manifesto TWA é um template sem numeração própria.

## Publicação

A web 166-R2 foi publicada em `https://app.tamoon.app.br/` em 28/10/2026, pelo Cloudflare Pages, a partir do merge `cdfe0df`. O registro de versão disponível da Comunidade também foi atualizado para 166. O `supabase-config.js` e o Digital Asset Links foram preservados.

A publicação web não envia o AAB ao Play Console. O pacote Android correspondente precisa ser carregado, revisado e distribuído pela faixa escolhida. Quem ainda usa o pacote 164 pode carregar a web 166 após a atualização dos arquivos web; o número nativo só muda quando a atualização Android é instalada.

## Documentação

- [Integração privada, permissões e roteiro no celular](integration/marketplace/README.md).
- [Android: compilação, assinatura e alinhamento de versões](android/README.md).
- [Texto preparado para revisão no Google Play](integration/marketplace/PLAY-CONSOLE.md).

O Marketplace está autorizado para o titular e duas contas de homologação (cliente e parceiro), mantendo os papéis existentes. A sincronização com o Teste FC continua exclusiva do titular. Os membros do Teste FC podem usar as interações normais dos jogos publicados pela ponte. Pagamentos reais e e-mails automáticos do sandbox permanecem desativados. Nenhum valor simulado é lançado no caixa real da Comunidade.

Preserve `supabase-config.js`, os ícones, as associações de domínio e as chaves de assinatura. Não publique credenciais privadas, não execute o schema consolidado sobre o banco atual e não reaplique as migrações já registradas.

A revisão web 166-R3 corrige a revalidação do acesso no app instalado e reconhece a lista privada de testes. O AAB 1.0.166 permanece válido; nenhum código nativo Android ou assinatura foi alterado nesta revisão.

A revisão web 166-R4 diferencia os atalhos da Comunidade: **Onde jogar** abre Buscar quadras e **Reservas de teste** abre Minhas reservas diretamente. O resumo dos jogos sincronizados continua no link **Resumo do grupo na Comunidade**, dentro do Marketplace. Os atalhos escolhem apenas telas da área do usuário após a validação de acesso; permissões, pagamentos, banco, pacote Android e assinatura permanecem iguais.
