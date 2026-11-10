# Preparação das lojas — 1.0.172 (178)

Em 10/11/2026, o responsável validou as funções administrativas na web e autorizou o envio às lojas.

## Conteúdo

Inclui a base web 171-ADMIN4 (merge 85519e6584b46a6334fb7573fa456f9a7ac38e62): consultas da Comunidade e Marketplace, gestão diária, pendências/suporte, agenda e monitor unificado de notificações. Quatro acessos em grade 2×2, Consultas detalhadas na primeira linha e remoção do atalho duplicado de devoluções. Inclui os ajustes visuais já validados. O monitor de notificações fica na administração da Comunidade.

Versão de distribuição 1.0.172, Android versionCode 178 e build Apple planejado 178. A configuração Xcode mantém CURRENT_PROJECT_VERSION 172 conforme a checagem existente; o workflow recebe 178 explicitamente ao arquivar. Nenhuma mudança nas dependências, ponte nativa, permissões ou regras de envio de push.

## Validação da preparação

- 226 testes de push/autenticação/integração passaram.
- Empacotamento local, estrutura iOS e configuração Android conferidos.
- Configuração Firebase cliente recuperada do AAB 177 cujo SHA-256 corresponde ao registro da publicação anterior. Chave de upload original recuperada do arquivo privado; nenhum material de assinatura vai para o Git.
- Verificador do archive iOS agora exige os novos recursos administrativos.
- Testes administrativos, emulador Android, layout e exclusão de conta da base ADMIN4 já haviam passado antes da aprovação do usuário.

## Estado

Preparação de código; ainda não representa compilação assinada, envio ou aprovação nas lojas. As sessões dos consoles Apple e Google precisam ser refeitas. A revisão Apple 1.0.171 deve ser conferida e preservada se ainda estiver em andamento; nesse caso, o novo build pode ser enviado para processamento, mas a nova submissão pública aguarda a anterior.
