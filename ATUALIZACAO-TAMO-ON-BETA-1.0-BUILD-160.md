# Tâmo On — Build 160: aceite em cartão centralizado

Base: Build 159. Aplicativo, HTML e Service Worker: 160. Banco: 149. publish-announcement: 114. delete-beta-user: 106.

## Alteração

O aceite obrigatório aparece em um cartão centralizado sobre fundo institucional escuro, com margens e cantos arredondados. O título é “Antes de começar”. Os documentos e as declarações têm rolagem interna; os botões “Aceitar e continuar” e “Sair da conta” permanecem acessíveis no rodapé.

As declarações começam desmarcadas. A confirmação de maioridade e os três campos continuam obrigatórios. O cartão não fecha ao tocar no fundo ou pressionar Escape. O foco do teclado permanece no cartão. Os dados e funções da comunidade continuam bloqueados até a confirmação do servidor.

A recuperação de conexão da Build 159 foi preservada. Os documentos, a vigência e os aceites já registrados não foram alterados. Quem já aceitou os documentos vigentes entra normalmente.

## Publicação

1. Extraia `Tamo-On-Build-160-INCREMENTAL.zip`.
2. Envie os dez arquivos extraídos para a raiz do repositório, preservando a pasta `legal`.
3. Aguarde o deployment do Cloudflare e atualize o aplicativo.
4. Confirme aplicativo, HTML e Service Worker 160 no diagnóstico. O banco permanece 149.

Não há SQL para executar, healthcheck de banco novo ou Edge Functions para republicar nesta atualização.

## Teste no celular

Use uma conta de teste que ainda não tenha aceitado os documentos vigentes. Não apague aceites existentes para testar.

1. Entre no app: o cartão deve aparecer centralizado, com fundo escuro e margens visíveis.
2. Abra um documento e role o conteúdo. A página externa deve permanecer parada e os botões acessíveis.
3. Feche o documento e role até as declarações. Todos os campos devem começar desmarcados.
4. Selecione “Tenho menos de 18 anos”: deve aparecer o aviso e o botão de aceite deve continuar bloqueado.
5. Selecione a declaração de maioridade e os três campos: o botão deve habilitar.
6. Toque uma vez em “Aceitar e continuar”: após a confirmação do servidor, o app deve abrir.
7. Entre novamente: o aceite não deve reaparecer para essa conta.
8. Em outra conta sem aceite, confira o botão “Sair da conta”.

Observe também se é fácil perceber a rolagem e localizar os campos em um iPhone pequeno. Esse teste no aparelho complementa a validação local.

## Validação realizada

Em Chromium com serviços simulados: telas de 1280×900, 390×844, 320×568 e 844×390; centralização e limites do cartão; ausência de rolagem externa; documentos expandidos e rolagem interna; bloqueio de fundo/Escape; navegação por teclado; menoridade; campos obrigatórios; recuperação após falha de conexão preservando seleções; reenvio confirmado; saída da conta. Sem erros de JavaScript nos cenários executados.

Sintaxe dos arquivos JavaScript, versões e integridade do ZIP conferidas. O teste local não utilizou um iPhone físico nem modificou o Supabase publicado.
