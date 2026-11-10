# Publicação nas lojas — 1.0.172 (178)

Em 10/11/2026, o responsável validou as funções administrativas na web e autorizou o envio às lojas.

## Conteúdo

Inclui a base web 171-ADMIN4 (merge 85519e6584b46a6334fb7573fa456f9a7ac38e62): consultas da Comunidade e Marketplace, gestão diária, pendências/suporte, agenda e monitor unificado de notificações. Quatro acessos em grade 2×2, Consultas detalhadas na primeira linha e remoção do atalho duplicado de devoluções. Inclui os ajustes visuais já validados. O monitor de notificações fica na administração da Comunidade.

Versão de distribuição 1.0.172, Android versionCode 178 e build Apple 178. A configuração Xcode mantém CURRENT_PROJECT_VERSION 172 conforme a checagem existente; o workflow recebeu 178 explicitamente ao arquivar. Nenhuma mudança nas dependências, ponte nativa, permissões ou regras de envio de push.

## Validação

- 226 testes de push/autenticação/integração passaram.
- Empacotamento local, estrutura iOS e configuração Android conferidos.
- CI Android aprovado, incluindo emulador: runs 42899868389 e 42899868433.
- Configuração Firebase cliente recuperada do AAB 177 cujo SHA-256 corresponde ao registro da publicação anterior. Chave de upload original recuperada do arquivo privado; nenhum material de assinatura foi para o Git.
- AAB e APK de distribuição assinados e verificados; certificado do AAB corresponde ao da versão 177.
- Verificador do archive iOS exige os novos recursos administrativos; archive assinado e upload concluídos com sucesso.
- Testes administrativos, emulador Android, layout e exclusão de conta da base ADMIN4 já haviam passado antes da aprovação do usuário.
- Google Play confirmou zero dispositivos que deixam de ser suportados em relação ao lançamento anterior.
- Aviso não bloqueante do Google: bibliotecas nativas sem símbolos de depuração. Mapeamento ReTrace incluído.

## Código e artefato

- Fonte dos dois builds: 821b754dfcf13d65329e810b62e77b29ee5a88a9.
- PR: https://github.com/edolbf-collab/tamo-on/pull/23
- Merge: 873bc4e6867ccafa8e5e59ed1cb068358e477427.
- Web confirmada em build 172 / integração 172-R1 após o merge.
- Android: Tamo-On-Android-1.0.172-178.aab, 20.896.824 bytes.
- SHA-256 Android: c3856e67274e2ce38eae2487af51c8b0b0476d8aa41fb7e3588a3b3faacfbddb.
- iOS: https://github.com/edolbf-collab/tamo-on/actions/runs/42900210918 (sucesso).

## Apple

A versão anterior 1.0.171 foi confirmada como Ready for Distribution. A nova 1.0.172 (178) foi submetida à revisão pública em 10/11/2026, às 18:13 (horário exibido no console), e o estado observado foi Waiting for Review.

Submissão: fb8ac4bc-4aed-41f4-95f2-da45848e63f3.
Build: c51c826f-fda7-45f5-8129-0f7bab87fa89.
Publicação automática após aprovação, para todos os usuários imediatamente. Metadados, capturas e acesso de revisão existentes preservados; novidades e notas de revisão atualizadas.

## Google Play

A versão anterior 1.0.171 (177) foi confirmada disponível em produção. O AAB 178 foi carregado e associado ao lançamento de produção “Tâmo On 1.0.172 (178) – Administração”, release 6, faixa 4697591489747865699.

Envio para revisão confirmado em 10/11/2026. Estado final observado: Alterações em revisão, com verificações rápidas ainda em andamento e encaminhamento automático à análise após aprovação dessas verificações. Implementação de 100%, países já segmentados preservados, publicação gerida desativada (publicação automática após aprovação).

## Limite desta confirmação

Os envios para produção foram concluídos nas duas lojas. Esta confirmação não equivale à aprovação ou disponibilidade pública da versão 1.0.172.
