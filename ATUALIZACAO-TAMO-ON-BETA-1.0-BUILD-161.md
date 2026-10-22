# Tâmo On — Build 161: seleção da lista para WhatsApp

Base: Build 160. Aplicativo, HTML e Service Worker: 161. Banco: 149. publish-announcement: 114. delete-beta-user: 106.

## Alteração

Na janela “Compartilhar lista”, quatro caixas em duas linhas permitem escolher Vou, Não vou, Espera e Sem resposta. Todas começam marcadas a cada abertura.

A prévia acompanha a seleção imediatamente. “Enviar pelo WhatsApp” e “Copiar lista” utilizam o mesmo texto. A identificação do evento é mantida. Categorias desmarcadas são omitidas por completo, incluindo títulos e contadores. Uma categoria selecionada sem participantes aparece com contagem zero e “Nenhum.”.

Se todas as categorias forem desmarcadas, os dois botões ficam desabilitados e aparece “Selecione pelo menos uma categoria.”. Para manter a tela compacta, o aviso anterior foi reduzido a uma frase e as opções têm área de toque de 44 px de altura.

Mantidas as regras atuais: somente administrador ou organizador compartilha; o recurso é liberado a partir do início do evento, quando terminam as confirmações. Não houve alteração de presença, convidados, ordem da espera ou dos dados armazenados.

## Publicação

1. Extraia `Tamo-On-Build-161-INCREMENTAL.zip`.
2. Envie os nove arquivos extraídos para a raiz do repositório no GitHub, substituindo os correspondentes.
3. Aguarde o deployment do Cloudflare e atualize o aplicativo.
4. Confira aplicativo, HTML e Service Worker 161. Banco permanece 149.

Não há SQL, migration, healthcheck de banco ou Edge Function para executar/publicar nesta atualização. Não é necessário reenviar ícones ou assets.

## Teste no aparelho

Em uma conta administradora ou organizadora, abra um evento cujo prazo de confirmação já terminou e toque em “Compartilhar lista”. Confira:

- As quatro opções começam marcadas e aparecem em duas linhas.
- Ao deixar somente “Sem resposta”, a prévia contém apenas essa categoria e a identificação do evento.
- “Copiar lista” e “Enviar pelo WhatsApp” reproduzem a seleção atual.
- Ao desmarcar tudo, os dois botões são bloqueados.
- Ao fechar e reabrir, todas as opções voltam a ficar marcadas.

O WhatsApp é aberto para que você escolha o destinatário e confirme o envio, como antes.

## Verificação local

Foram testadas em Chromium as 16 combinações das quatro categorias, o texto padrão comparado à Build 160, a igualdade entre prévia/cópia/WhatsApp, categoria vazia, ausência de seleção, reinicialização da seleção e as restrições de permissão e horário. WhatsApp e área de transferência foram simulados; nenhuma mensagem foi enviada.

Layout inspecionado em 390×844 e 320×568; dimensões e área de toque também verificadas em 1280×900. Não houve erros de JavaScript nos testes. Sintaxe, versões e integridade do ZIP foram verificadas. O teste em iPhone físico deverá ser feito após a publicação.
