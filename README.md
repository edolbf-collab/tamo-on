# Tâmo On — Beta 1.0 Build 166-R2

Comunidade PWA e aplicativo Android para grupos esportivos, jogos, presença, times, churrasco e caixa. A build 166-R2 inclui o piloto privado do Marketplace C39-R1, conectado exclusivamente ao grupo Teste FC.

## Versões

| Componente | Versão |
| --- | --- |
| Web, HTML e Service Worker | 166 / revisão 166-R2 |
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

O Marketplace continua autorizado somente para a conta configurada no servidor. Os membros do Teste FC podem usar as interações normais dos jogos publicados pela ponte. Pagamentos reais e e-mails automáticos do sandbox permanecem desativados. Nenhum valor simulado é lançado no caixa real da Comunidade.

Preserve `supabase-config.js`, os ícones, as associações de domínio e as chaves de assinatura. Não publique credenciais privadas, não execute o schema consolidado sobre o banco atual e não reaplique as migrações já registradas.
