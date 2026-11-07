# Android — Tâmo On

Projeto original da build 164, preservando pacote `br.app.tamoon`, domínio `app.tamoon.app.br`, recursos, permissões e Android Browser Helper 2.7.4. A versão é lida diretamente do `version.json` da raiz: build 166 gera `versionCode=166` e `versionName=1.0.166`.

## Um número por entrega

1. Definir a próxima build em `../version.json` e atualizar os números web em `../app.js`, `../index.html` e `../service-worker.js`.
2. O Gradle deriva a versão Android desse arquivo. A tarefa `validateCommunityRelease`, executada antes da compilação, rejeita divergências entre os quatro arquivos.
3. Compilar o AAB com a chave de upload existente e registrar o commit web correspondente.
4. Publicar a web e conferir o número retornado por `https://app.tamoon.app.br/version.json`; atualizar o registro `app_releases` somente depois do deploy confirmado.
5. Enviar o AAB correspondente ao Play Console e concluir sua distribuição. Só então o número nativo nos aparelhos atualizados também muda.

A TWA usa a aplicação web hospedada, sem copiar o Marketplace para dentro do AAB. Atualizações web posteriores também chegam aos pacotes Android antigos. Portanto, o alinhamento numérico da entrega não obriga os usuários a atualizar imediatamente o pacote instalado. Registrar separadamente a build web publicada e o último AAB distribuído evita confundir esses estados.

`twa-manifest.json` é um template de origem, sem versão própria; o fluxo de release deste repositório usa Gradle. Caso regenere o projeto com outra ferramenta, preserve a leitura da versão e a tarefa de validação.

## Ícone compartilhado com iOS

O ícone Android e a imagem de 512 px da Google Play usam a marca verde sobre fundo escuro aprovada no iOS. Execute `bash android/sync-launcher-icons.sh` a partir da raiz para atualizar os recursos a partir de `native-assets` (requer ImageMagick). O ícone adaptativo mantém a margem segura do símbolo; os ícones convencionais e a imagem da loja derivam do original iOS. O ícone de notificação permanece monocromático.

`android/store_icon.png` é a imagem para a página da loja. A mudança do ícone instalado exige distribuir um novo AAB com a chave de upload existente; alterar somente a página da Google Play não atualiza os aparelhos.

## Compilação do pacote

Requisitos: JDK 17 completo (incluindo `javac`), Android SDK Platform 36, Build Tools 36.0.0. Gradle 9.1.0 é baixado pelo wrapper e verificado por checksum. Android Gradle Plugin 9.0.1 e Browser Helper 2.7.4 estão fixados.

Configure `ANDROID_HOME` ou `local.properties` apontando para o SDK. Forneça as variáveis abaixo ao processo de compilação; seus valores não devem ser incluídos no repositório:

- `TAMOON_KEYSTORE`: caminho absoluto do keystore original de upload.
- `TAMOON_STORE_PASSWORD`: senha do keystore.
- `TAMOON_KEY_PASSWORD`: senha da chave.

Alias existente: `tamoon-upload`. Reutilize a assinatura da build 164. Não gere uma nova chave de upload para cada build.

Na pasta `android/`, execute `./gradlew bundleRelease assembleRelease` (Linux/macOS) ou `gradlew.bat bundleRelease assembleRelease` (Windows). AAB: `app/build/outputs/bundle/release/app-release.aab`. APK de teste: `app/build/outputs/apk/release/app-release.apk`.

Valide o pacote, versão, SDK, assinatura e domínio antes de enviar. A validação prática de login Google, notificações e Marketplace continua necessária em aparelho Android. O APK local usa a chave de upload; a instalação distribuída pelo Google pode usar a chave de assinatura do Play, preservada no Digital Asset Links.

## Janela de abertura e validação Android

A atividade nativa usa o tema `TamoOnLaunchTheme` antes de transferir o controle ao navegador. No Android 15 ou superior o sistema cuida das barras transparentes. Em versões anteriores as cores são declaradas no tema. O Browser Helper 2.7.4 chama diretamente a implementação antiga do AndroidX. A instrumentação no Gradle substitui somente essa chamada por `LaunchWindow.configure`. Ao atualizar a biblioteca, confira se essa adaptação ainda é necessária.

O workflow de pull request compila o release com uma chave descartável e confere o mapeamento do R8. Para homologação visual, abra a Comunidade e o Marketplace no Android 15 e 16, em retrato e paisagem, com navegação por gestos e por três botões. Confira o primeiro acesso, os controles inferiores e o fechamento das janelas de Pix e cotas.

## Preparação do Console para a build 166

Nome sugerido: `Tâmo On - Beta 1.0.166`.

```text
<pt-BR>
Integração com o marketplace em piloto privado.
Reservas de quadras em ambiente de teste, com pagamentos simulados.
Integração de jogos de teste com presença, times e churrasco da Comunidade.
O acesso ao marketplace permanece restrito às contas autorizadas.
</pt-BR>
```

A restrição é aplicada pelo servidor e continua valendo para o AAB 166. Antes de submeter a funcionalidade à revisão, configurar e validar uma conta dedicada com acesso ao que será analisado. O piloto atual permite o titular e duas contas de homologação com papéis de cliente e parceiro; não compartilhar sua conta pessoal. Ver `../integration/marketplace/PLAY-CONSOLE.md`. Nenhum envio ao Google Play é executado pelo build ou pelo deploy web.

Referências: [versionamento Android](https://developer.android.com/studio/publish/versioning), [assinatura do aplicativo](https://developer.android.com/studio/publish/app-signing).
