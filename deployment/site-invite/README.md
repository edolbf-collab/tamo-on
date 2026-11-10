# Convites pelo endereço do QR code

O compartilhamento passa a usar `https://tamoon.app.br/baixar?invite=CODIGO`.
A página mostra o código, permite copiá-lo e oferece abertura no app por
`br.app.tamoon://invite?code=CODIGO`. O ingresso continua exigindo login, aceite
obrigatório e confirmação no formulário existente. Nenhuma associação automática
ou mudança de permissões do grupo é feita.

## Site institucional

Aplicar sobre a **pasta completa mais recente** do site:

```sh
node deployment/site-invite/apply.mjs /caminho/do/site-atual
```

O script substitui apenas `download.js` e a referência versionada em
`baixar/index.html`. Preserva as demais páginas, imagens e alterações do site.
Publicar a pasta completa na Cloudflare Pages. Esta pasta de correção isolada
não é um site completo e não deve ser enviada sozinha como deployment.

Sem `invite`, o QR continua encaminhando à loja do aparelho. Com convite, a
página permanece aberta e exibe as duas lojas. O código permanece na mensagem
compartilhada e a opção web também o conserva. O QR genérico é ocultado nesta
página específica para evitar perder o código ao escaneá-lo.

## Apps

O Android ganha um filtro separado para o host `invite`; o callback de OAuth
permanece intacto. O iOS já declara o esquema `br.app.tamoon`. Ambos recebem
`appUrlOpen` e `getLaunchUrl`, guardando o código até o usuário estar autenticado
e com os termos aceitos. O lançamento original é consumido uma vez por sessão;
novos toques continuam funcionando. O marketplace retorna à Comunidade local.

A abertura com código preenchido exige novos binários Android e iOS. A versão
176 já instalada ainda permite informar o código manualmente. O número de
release deve ser atualizado antes da assinatura, após conferir os números nas
lojas. Não há promessa de transporte automático do convite pela instalação:
o usuário volta ao link ou informa o código após instalar.

## Verificação

```sh
node --test mobile/tests/invite.test.mjs
npm run sync:android --prefix mobile
npm run check --prefix mobile
npm run check:android --prefix mobile
# Com o Chromium do Playwright instalado:
node mobile/tests/invite-page.mjs
```

Validar nos aparelhos antes de distribuir os novos binários: convite pelo
WhatsApp com app fechado, aberto, usuário desconectado, aceite de termos
pendente e marketplace aberto. Conferir código preenchido, confirmação de
entrada e ausência de reabertura ao navegar depois de entrar. Testar também
instalação inicial e retorno ao mesmo link. Convites antigos da versão web
permanecem compatíveis, sem redirecionamento retroativo nesta alteração.
