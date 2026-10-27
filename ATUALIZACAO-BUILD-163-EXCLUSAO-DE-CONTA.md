# Tâmo On — Build 163: solicitação de exclusão da conta

Base: Build 162 validada / Banco 150 / publish-announcement 115 / delete-beta-user 106.
Nova versão: aplicativo, HTML e Service Worker **163**. Banco e Edge Functions mantêm as versões existentes.

## O que foi implementado

**Página pública “Excluir minha conta”:** `/legal/excluir-conta.html`. Identifica o Tâmo On Comunidade, a empresa e o CNPJ; explica o procedimento, a verificação de titularidade, as consequências, os dados envolvidos e os prazos de exclusão e retenção. Pode ser consultada sem login e sem reinstalar o app. Funciona sem JavaScript.

**Solicitação por e-mail:** o botão “Solicitar exclusão por e-mail” prepara uma mensagem para `privacidade@tamoon.app.br`, com assunto e texto preenchidos. O usuário informa o e-mail da conta e envia a mensagem no seu serviço de e-mail. A página explica que abrir o botão não envia a solicitação nem exclui a conta. O endereço e as instruções permanecem visíveis para quem não tem um aplicativo de e-mail configurado.

**Caminho no aplicativo:** Mais → Documentos e privacidade → **Solicitar exclusão da conta**. O atalho aparece em destaque no início da janela e abre a mesma página pública em nova aba. Também é acessível pela janela Meu perfil → Documentos e privacidade. A descrição do item no menu agora menciona exclusão da conta.

**Acesso mesmo com falha de consulta:** o atalho aparece imediatamente, antes de consultar os documentos no servidor. Se a consulta falhar ou exceder 12 segundos, o pedido continua disponível e há um link para a central pública. Fechar a janela durante a consulta não faz a janela reabrir quando a resposta chega.

**Central pública:** `/legal/` também passa a mostrar “Excluir minha conta” em destaque. A página de exclusão entra na lista de cache do Service Worker; o envio do e-mail depende da conexão e do serviço de e-mail do usuário.

A tela de aceite mantém as correções das builds 159 e 160. Os três documentos jurídicos v1.2, seus textos, hashes e registros de aceite não são modificados. Esta atualização não exige novo aceite. Os recursos da build 162 e o controle de acesso do beta são preservados.

## Arquivos do pacote

Extraia `Tamo-On-Build-163-INCREMENTAL.zip`. Ele contém:

| Arquivo | Finalidade |
| --- | --- |
| `app.js` | Build 163 e descrição do menu com exclusão da conta. |
| `index.html` | Identificação 163 e referências de atualização dos recursos. |
| `pwa-bootstrap.js` | Referência de versão para atualização do PWA. |
| `service-worker.js` | Build/cache 163 e página de exclusão no cache. |
| `version.json` | Metadados da nova versão. |
| `legal/acceptance.js` | Atalho em destaque e consulta de documentos com recuperação de falha. |
| `legal/legal.css` | Estilo do novo atalho, preservando a tela de aceite existente. |
| `legal/index.html` | Destaque para exclusão na central pública. |
| `legal/excluir-conta.html` | Nova página pública independente. |
| `ATUALIZACAO-BUILD-163-EXCLUSAO-DE-CONTA.md` | Este guia. |

O pacote é incremental e pressupõe que a build 162 esteja instalada. Não substitua o projeto inteiro por estes arquivos; sobreponha-os à raiz existente, mantendo as pastas e os demais arquivos.

## Publicação — nesta ordem

1. Confirme que consegue receber e responder mensagens em **privacidade@tamoon.app.br**. A build utiliza a caixa já indicada na Política de Privacidade; não cria nem configura o serviço de e-mail.
2. Revise a rotina de atendimento abaixo. Os prazos publicados reproduzem a política existente e precisam corresponder ao atendimento e às retenções efetivas. A própria política v1.2 exige essa correspondência antes da abertura pública.
3. Extraia o ZIP e envie **todo o conteúdo à raiz do repositório no GitHub**, preservando a pasta `legal`. Aguarde o deployment do Cloudflare Pages.
4. **Não execute SQL nesta atualização. Não publique Edge Functions.** O Banco permanece 150; `publish-announcement`, 115; `delete-beta-user`, 106.
5. Abra em janela anônima: **https://app.tamoon.app.br/legal/excluir-conta.html**. Confira título, identificação, botão, e-mail, dados e prazos. A URL estará disponível após o deployment.
6. No app, verifique a atualização, feche e reabra se necessário. Em Mais → Sobre e diagnóstico, confira Aplicativo **163**, HTML **163**, Service Worker **163** e Banco **150**.
7. Faça os testes descritos abaixo no navegador e no app instalado. Após validar a página publicada, informe **https://app.tamoon.app.br/legal/excluir-conta.html** no campo de URL de exclusão de contas do formulário **Segurança dos dados** do Play Console. As respostas do formulário devem refletir o tratamento real de dados.

Não é necessário reenviar os documentos jurídicos v1.2, ícones ou arquivos nativos. Este pacote atualiza a aplicação web/PWA; não contém um novo AAB Android. A eventual geração ou atualização do pacote Android continua no fluxo de publicação já utilizado.

## Atendimento pela administração

Esta build cria o caminho de solicitação. **O envio não dispara exclusão automática**, não cria protocolo no banco e não adiciona uma fila de pedidos ao painel. O acompanhamento é feito pelo e-mail e pelo registro operacional da administração.

1. **Receber e registrar.** Acompanhe a caixa de privacidade e registre data do pedido, conta indicada, responsável, situação e prazo de acompanhamento. Responda à pessoa na mesma conversa de e-mail, confirmando o recebimento e as próximas etapas. O envio a partir do e-mail da conta ajuda na verificação, mas não substitui a análise de titularidade.
2. **Verificar a titularidade.** Use confirmação proporcional ao risco. Não peça senha do Google ou códigos de acesso. Se a pessoa perdeu acesso ao e-mail, ofereça verificação alternativa; não condicione o pedido a entrar no app ou reinstalá-lo. Não exija uma justificativa para a decisão de excluir.
3. **Delimitar dados e retenções.** Confira conta/perfil, vínculos, notificações, eventos, convidados, avaliações, caixa, aceites, logs, feedback, denúncias, arquivos e fornecedores. Identifique o que será excluído ou anonimizado e o que tem fundamento concreto para retenção. Para cada retenção, registre motivo, prazo ou evento final e responsável pela revisão.
4. **Executar o encerramento.** Para contas comuns, utilize o recurso administrativo existente de exclusão permanente no Painel Beta, somente depois da confirmação do pedido e da titularidade. Confira cuidadosamente o e-mail. O procedimento é irreversível; a ferramenta protege a própria conta e contas administradoras da plataforma. Solicitações que envolvam esses casos exigem tratamento administrativo específico, sem contornar as proteções pela interface.
5. **Conferir dados associados.** A ferramenta existente trata a conta, os vínculos e a anonimização prevista nos históricos. A conclusão do pedido também exige revisar os dados associados que possam permanecer fora desse fluxo, inclusive dados mantidos por fornecedores. A build 163 não altera a função de exclusão nem adiciona expurgo automático.
6. **Revisar denúncias da build 162.** Evidências preservadas, nomes, e-mails em textos livres e cópias de conteúdo podem continuar identificando alguém mesmo depois de o perfil aparecer como “Usuário excluído”. Exclua ou anonimize o que não tiver justificativa de retenção. Para provas que precisem permanecer, restrinja acesso, registre a finalidade e defina a revisão e o evento de descarte. Não presuma que remover a conta elimina todos esses conteúdos.
7. **Verificar e responder.** Confira o encerramento do acesso e dos vínculos e informe à pessoa a conclusão da exclusão operacional, os dados eventualmente retidos, a justificativa e o prazo/evento de término. Registre a data da conclusão e acompanhe backups e retenções até seu encerramento.

A página informa exclusão operacional em até **30 dias após a conclusão do fluxo de confirmação de titularidade e do pedido**, conforme o prazo da política existente. Esse é um compromisso operacional do Tâmo On; não é um prazo universal imposto pelo Google. A caixa e as etapas de confirmação precisam ser acompanhadas para não deixar solicitações paradas indefinidamente.

Backups seguem o ciclo técnico, com expurgo **preferencial em até 90 dias após a exclusão operacional**, conforme a política. A build não cria um agendamento de expurgo. Os demais prazos e ressalvas estão na página e na Política de Privacidade; períodos de conservação não devem ser usados como justificativa automática para manter todos os dados após um pedido válido.

## Testes após publicar

1. **Sem login:** abra a URL de exclusão em janela anônima. Não deve pedir login, redirecionar à tela inicial nem exigir instalação. Confira também o acesso pela central pública `/legal/`.
2. **Dentro do app:** Mais → Documentos e privacidade. O atalho deve estar no início da janela e abrir a mesma página. Teste também Meu perfil → Documentos e privacidade.
3. **E-mail:** toque em Solicitar exclusão por e-mail. Confira destinatário, assunto e texto. Sem cliente configurado, siga as instruções para copiar o endereço e enviar pelo webmail. Para testar a entrega, use uma mensagem claramente identificada como teste; não solicite a exclusão da conta administradora.
4. **Documentos e aceites:** abra os três documentos, baixe seus registros de aceite e, com a conta administradora, confira a auditoria. O fluxo e os registros anteriores devem continuar disponíveis.
5. **Celular:** valide Android e iPhone, navegador e modo instalado, abertura da página e do serviço de e-mail, leitura dos prazos e retorno ao app.
6. **Atendimento completo:** use uma conta de teste dedicada, com autorização de seu titular, para testar recebimento, verificação, exclusão administrativa, tratamento dos dados associados e resposta final. Não use uma conta real em uso para esse teste irreversível.

## Validação local executada

Foram aprovadas 49 verificações locais automatizadas. A validação abrange sintaxe JavaScript, consistência das versões, integridade do pacote, página pública sem JavaScript, destinatário e texto do e-mail, navegação pela central e pelo atalho do app, layout em 320/390/1280 pixels, exportação de aceites e auditoria, falha de consulta, conteúdo inválido, timeout e fechamento da janela antes da resposta.

O módulo de documentos foi testado com a função real de modal do aplicativo e respostas sintéticas de servidor. O trecho do aceite obrigatório e os estilos da build 160 foram conferidos por comparação com a base. Esses testes não enviam e-mails, não excluem contas, não verificam a caixa postal nem executam as rotinas de retenção em produção. A entrega não altera o ambiente publicado.

## Referência

[Google Play — Noções básicas sobre os requisitos de exclusão de contas de apps](https://support.google.com/googleplay/android-developer/answer/13327111?hl=pt-BR): permite que o caminho no aplicativo aponte para um recurso público da web e que a solicitação seja feita por e-mail de atendimento. Exige identificação, acesso claro ao pedido e tratamento dos dados associados. A página e o caminho no app fazem parte desse atendimento; a aprovação da loja também depende das práticas efetivas e das declarações do aplicativo.
