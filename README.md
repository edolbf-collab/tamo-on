# Tâmo On — Build 165: preparação iOS

Base: build 164 publicada no repositório, commit 704a625b1e297599b64dee61c6c544099a700a52.

Esta preparação acrescenta projeto iOS com Capacitor 8.5.3, login nativo Apple, OAuth Google por sessão de autenticação do iOS, Keychain, compartilhamento, exportação de arquivos e solicitação de exclusão dentro do app.

Leia `PREPARACAO-IOS-BUILD-165.md` antes de implantar. O projeto ainda precisa das credenciais Apple, compilação no Xcode e validação em iPhone. Push APNs e a atualização dos documentos de privacidade continuam pendentes.

Não há IPA assinado neste pacote. Nenhuma alteração desta preparação foi aplicada ao Supabase, Cloudflare ou Google Play em produção.

Versões: cliente 165; incremento de banco 152; publish-announcement 115 (preservado); delete-beta-user 107; apple-sign-in 1.

O pacote é incremental sobre a build 164: não execute `backend/supabase-schema.sql`, não recrie tabelas e não substitua as credenciais existentes. Os documentos 1.2 e seus aceites foram preservados.
