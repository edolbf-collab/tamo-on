# Correção da abertura nativa — TestFlight 169

## Falha observada

No primeiro acesso pelo TestFlight 1.0.168 (168), o aplicativo exibia `"TamoonNative" plugin is not implemented on ios` sob o título genérico "Falha na conexão".

O `SceneDelegate` criava diretamente `CAPBridgeViewController`, substituindo o controlador declarado no storyboard. Assim, `TamoonViewController.capacitorDidLoad()` não executava o registro de `TamoonNativePlugin`. A primeira leitura do Keychain falhava antes de apresentar a tela de login. O problema estava no pacote nativo, não no cadastro do tester.

## Alteração

O caminho de abertura por cena agora instancia `TamoonViewController`. A implementação do plugin, o armazenamento no Keychain, os identificadores Apple e os serviços publicados permanecem os mesmos. A correção precisa de um novo binário: atualizar os arquivos da versão web não substitui o código Swift instalado.

## Verificação

- Checagem de empacotamento agora verifica também o controlador criado pelo `SceneDelegate`.
- Teste XCTest hospedado no aplicativo verifica o controlador efetivamente aberto, a disponibilidade JavaScript de `TamoonNative`, leitura/gravação/remoção de uma chave de teste isolada e a tela de login com Google e Apple.
- O alvo XCTest é gerado apenas no checkout de validação; não entra no pacote distribuído.
- Testes locais: 6 de autenticação nativa e 147 de integração passaram.
- Compilações Debug/simulador e Release/arm64 passaram.
- Na validação macOS, também passaram 6 testes de cifragem/revogação Apple e o XCTest de abertura nativa, com zero falhas. O teste executou chamadas reais da ponte para o Keychain e confirmou os botões de entrada Google/Apple; não realizou login em conta real.
- [Execução de validação aprovada](https://github.com/edolbf-collab/tamo-on/actions/runs/41841694430), commit `d461c7f6fbea51fc9173f093df2f1eaac80a38ba`. A assinatura ad hoc e os entitlements do simulador são gerados apenas para o teste.

## Envio e distribuição

Em 4/11/2026, o build **1.0.168 (169)** foi assinado e enviado à Apple na [execução de upload](https://github.com/edolbf-collab/tamo-on/actions/runs/41841122401), concluída com sucesso. Código enviado: `34e01428fd017cf4d6e23b0829d09902cf5c5d54`. Os commits posteriores usados na validação ajustam somente os testes e o workflow; o código de produção é o mesmo.

A Apple concluiu o processamento e exibiu **Pronto para testar**. As instruções de teste foram salvas. A versão de conteúdo continua 168-R3; somente o número Apple aumenta para distinguir o pacote corrigido.

Após autorização explícita do titular em 4/11/2026, o build 169 foi associado ao grupo existente **Piloto interno**. O App Store Connect confirmou **Grupo (1)**, **Piloto interno**, tipo **Interno**, com **1 tester**. Nenhum tester novo foi adicionado e o build 168 não foi expirado. O resumo técnico foi autorizado para registro na `main`.

Validação ainda necessária no iPhone: atualização pelo TestFlight, abertura da tela de entrada, login Google ou Apple, acesso aos grupos, manutenção da sessão ao fechar/reabrir e entrada/volta do Marketplace. A execução automatizada não substitui esse teste no aparelho.
