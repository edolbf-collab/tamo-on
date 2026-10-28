# Preparação da privacidade e revisão — iOS 165

Documento de trabalho, não publicado. Não altera a vigência, o texto ou os aceites da versão 1.2.

## Revisão da política antes de ativar Apple

A política 1.2 descreve nome, e-mail, identificador Google e foto na categoria de autenticação. Na próxima versão, incluir Apple como provedor, identificador Apple, opção de e-mail privado e armazenamento cifrado da credencial necessária à revogação. Explicar que o nome pode ser fornecido apenas no primeiro login e pode ser corrigido no perfil.

Acrescentar Apple à relação de fornecedores de autenticação. Atualizar o procedimento de direitos para informar o pedido dentro do app, confirmação, prazo de 30 dias e protocolo. O e-mail continua uma alternativa para quem perdeu o acesso; não é requisito para concluir o pedido iniciado no app.

Texto de trabalho sugerido para o procedimento:

> Você pode solicitar a exclusão da sua conta e dos dados pessoais associados em Mais → Excluir minha conta. Após confirmar, receberá um protocolo para acompanhar o pedido. A exclusão operacional será concluída em até 30 dias. Não é necessário enviar e-mail ou justificar o pedido iniciado no aplicativo. Os dados sujeitos a retenção justificada seguem os prazos informados nesta Política. Sua conta Google ou Apple continuará existindo; o vínculo de autenticação com o Tâmo On será revogado quando aplicável.

Criar uma nova versão e seus hashes/registro de aceite pelo procedimento jurídico existente, com revisão dos responsáveis e data de vigência definida. Não substituir silenciosamente o HTML 1.2 já aceito pelos usuários. A atualização de texto/ativação não foi executada neste pacote.

## Inventário inicial para App Privacy

O manifesto `mobile/ios/App/App/PrivacyInfo.xcprivacy` contém uma declaração inicial baseada no código. O formulário App Privacy no App Store Connect é separado e precisa ser conferido antes do envio, incluindo os serviços efetivamente configurados.

| Dados observados | Uso principal | Ligação à conta |
|---|---|---|
| Nome, e-mail, identificador de conta | Acesso e perfil | Sim |
| Foto/referência de foto de perfil | Identificação no grupo | Sim |
| Grupos, eventos, presença, avaliações, avisos e feedback | Funcionalidades da comunidade | Sim |
| Valores de cobranças, pagamentos e despesas registrados manualmente | Caixa do grupo; o app não processa pagamentos | Sim |
| Eventos de uso e diagnósticos | Operação, suporte e correção | Sim |

O pacote nativo não inclui o beacon de analytics do Cloudflare, publicidade ou pedido de rastreamento. Isso não significa ausência de logs: Supabase e outras camadas de infraestrutura podem registrar dados técnicos. Confirmar práticas e retenção dos fornecedores.

Não marcar “não coletamos dados”. Não declarar “Saúde” apenas porque o produto organiza esportes: classificar os campos realmente tratados. Nenhuma permissão nativa de localização, contatos, câmera ou microfone foi acrescentada nesta preparação.

## Conferências para TestFlight e App Review

- Login Apple normal e com e-mail oculto; nenhuma exigência de e-mail real após a opção de ocultar.
- Mesmo usuário em aparelhos distintos; explicar eventual conta separada se alternar Google e Apple com e-mails diferentes. Não fazer fusão automática de contas por nome.
- Credencial Apple revogada fora do app: verificar encerramento da sessão.
- Conta fictícia criada, perfil editado, grupo criado, pedido e conclusão de exclusão com revogação e protocolo.
- Notificações APNs ainda pendentes; não anunciar recebimento em segundo plano antes de implementar e testar.
- Recursos de denúncia, bloqueio, moderação e canal de suporte funcionando.
- Capturas de tela reais da versão iOS, com dados fictícios e dimensões aceitas no App Store Connect.
- Questionário de classificação etária respondido pelos recursos reais; público pretendido 18+ não dispensa o questionário Apple.
- Ambiente e instruções de acesso suficientes para o revisor; não enviar senhas pessoais. A conta e o grupo de demonstração ainda precisam ser definidos.
- Declaração de criptografia: projeto usa TLS, Keychain, AuthenticationServices e CryptoKit. A opção inicial `ITSAppUsesNonExemptEncryption=false` precisa ser confirmada no questionário de exportação conforme a distribuição real; não é parecer jurídico.
- Conferir no Archive o relatório agregado dos manifests dos SDKs e os avisos de privacidade antes de enviar.

Não foram criadas contas fictícias no banco de produção nem enviadas mensagens a usuários durante esta preparação.
