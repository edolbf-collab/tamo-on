# Build 168 — pedido de exclusão no app

O usuário registra o pedido em **Mais → Excluir minha conta**, sem enviar e-mail. Funciona no navegador e no PWA do iPhone. O acesso também existe para contas sem grupo, bloqueadas ou ainda sem aceite dos documentos.

O servidor usa a identidade e a sessão ativa, exige confirmação explícita e devolve um protocolo aleatório. Repetir o pedido conserva o mesmo protocolo e prazo de 30 dias. A consulta pelo protocolo continua disponível depois da saída ou exclusão da conta. O e-mail permanece como alternativa para quem perdeu o acesso.

## Atendimento administrativo

1. Abra **Mais → Pedidos de exclusão**. A fila exibe o prazo e o e-mail verificado da conta. O pedido abrange Comunidade, Marketplace e prestadores aplicáveis.
2. Pelo procedimento administrativo existente, confira e trate perfil, grupos, notificações, reservas, cotas, conversas, vouchers, restituições e cadastro de parceiro aplicáveis. Registre dados retidos, justificativa e prazo ou critério. Não cancele nem liquide obrigações financeiras por causa do pedido de exclusão.
3. Registre a revisão dos dois ambientes e a informação destinada ao titular. Não inclua dados pessoais ou credenciais no texto do protocolo. “Não há dados associados” exige verificação; não é uma opção padrão.
4. Conclua a exclusão efetiva pelo procedimento administrativo atual. A fila desta versão **não apaga contas ou dados**. Depois de remover o acesso, reabra a fila e selecione **Registrar conclusão**. O servidor exige a revisão e a ausência da conta no Auth antes de aceitar a conclusão, remove o e-mail do pedido e atualiza o protocolo.

O prazo continua sendo de até 30 dias, com acompanhamento pela equipe. O protocolo não afirma conclusão apenas porque a conta de acesso foi removida. A revisão e o tratamento dos dados do Marketplace continuam sendo administrativos; não há automação de exclusão entre projetos nesta versão.

## Escopo e validação

- Migração aplicada: `20261104030527_in_app_account_deletion_requests_build_168.sql`. Tabela protegida por RLS e sem acesso direto de clientes. RPCs de pedido verificam sessão ativa; RPCs administrativas conferem também a identidade armazenada no Auth.
- Não foram instalados gatilhos de exclusão nem substituídas as rotinas permanentes existentes. A proposta mais ampla foi bloqueada pela revisão automática de aprovação; esta versão foi reduzida ao registro e acompanhamento sem exclusões automáticas.
- 145 testes existentes, 32 verificações locais de banco, 18 verificações de interface e 12 verificações no servidor com dados sintéticos e rollback. Nenhuma conta real foi alterada nos testes.
- O workflow `Account deletion validation` executa o fluxo móvel em WebKit no macOS. Isso não equivale a testar em um iPhone físico; a validação no aparelho continua necessária.
- A versão nativa iOS continua em preparação, sem novo envio à App Store ou ao TestFlight por esta atualização.

## Revisão 168-R2

O menu Mais concentra o pedido de exclusão em iOS, Android e web/PWA. O centro Documentos e privacidade e a tela inicial sem grupo não repetem o atalho. Quem está bloqueado ou na tela de aceite conserva o acesso ao mesmo pedido, pois ainda não consegue chegar ao menu Mais.

A interface apresenta uma única conta do Tâmo On. Não existe seleção de escopo por ambiente: o pedido sempre abrange a conta inteira. A equipe não deve registrar conclusão enquanto restarem providências em qualquer parte do aplicativo, ressalvadas as retenções justificadas documentadas.

A página externa de exclusão continua disponível para quem perdeu o acesso ou desinstalou, conforme a exigência do Google Play: https://support.google.com/googleplay/android-developer/answer/13327111 . A página não é um segundo atalho no menu Documentos e privacidade.
