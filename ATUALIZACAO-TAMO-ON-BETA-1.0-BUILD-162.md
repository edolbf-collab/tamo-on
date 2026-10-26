# Tâmo On — Build 162: segurança e convivência

Base: Build 161 / Banco 149 / publish-announcement 114.
Nova versão: aplicativo, HTML e Service Worker **162**, Banco **150**, publish-announcement **115**. A função delete-beta-user permanece **106**.

## O que foi implementado

**Denunciar participante ou conteúdo:** em Membros, toque no nome de outra pessoa; nos avisos e eventos, use Denunciar. Em Mais → Segurança e convivência → Denunciar outro conteúdo, também é possível selecionar convidados, denunciar o grupo atual ou uma notificação recebida. O formulário exige motivo e relato. O protocolo e o andamento ficam em Minhas denúncias.

A identidade de quem denunciou não aparece para a pessoa denunciada nem para administradores comuns do grupo. A administração da plataforma analisa os relatos. O banco captura a evidência a partir do registro ao qual a pessoa tem acesso; o aplicativo não pode enviar uma evidência adulterada como se fosse o conteúdo original. Textos são preservados; para avatares, preserva-se a referência da imagem, não uma cópia do arquivo remoto.

**Bloquear e desbloquear:** em Membros, toque no nome → Bloquear participante → Confirmar bloqueio. Mais → Segurança e convivência → Bloqueados permite desfazer a ação, inclusive após deixar o grupo. O bloqueio vale nos grupos em comum e impede avisos/notificações entre as duas contas e novas avaliações entre elas. A foto da pessoa bloqueada deixa de aparecer para quem bloqueou. Desbloquear remove apenas o bloqueio feito pela própria pessoa; um bloqueio feito pela outra conta continua válido.

Presenças, listas de espera, times, nomes necessários à identificação, avaliações anteriores, cobranças, pagamentos e despesas são preservados. Portanto, o bloqueio pessoal não remove a pessoa do grupo, não cancela obrigações e não suspende a conta. Comunicados gerais do Tâmo On continuam sendo entregues. Convidados sem conta podem ser denunciados, mas não há conta para bloquear.

Avisos antigos voltam a aparecer ao desfazer o bloqueio, salvo retirada pela moderação. Notificações suprimidas durante o bloqueio não são reenviadas. Push já enviado ao serviço de notificações ou entregue ao celular não pode ser recolhido por essa atualização.

## Administração

A conta registrada como administradora da plataforma acessa Mais → Segurança e convivência → Moderação. Há também um atalho no Painel Beta. O contador indica relatos recebidos ou em análise; a fila prioriza esses relatos e possui paginação.

Cada análise registra andamento, resposta para quem denunciou, responsável e histórico das decisões. É possível retirar um aviso do grupo da exibição, restaurá-lo após revisão ou suspender uma conta pela regra de acesso já existente. As medidas exigem confirmação; nenhuma conta é suspensa automaticamente pela quantidade de denúncias. Contas da administração da plataforma não podem ser suspensas por esse fluxo.

A retirada de um aviso também oculta suas notificações e impede novos reenvios. A evidência permanece disponível à moderação. Para relatos sobre o nome do grupo ou dados do evento, não se atribui automaticamente a responsabilidade ao criador original, pois outros gestores podem ter editado esses dados. Nesses casos, a análise e as providências de correção são humanas; não há exclusão automática dos registros do grupo.

A administração deve acompanhar a fila: esta build não envia e-mail nem push automático aos moderadores. Uma resposta registrada é mostrada a quem denunciou; ela não é uma comunicação automática à pessoa denunciada. Advertências, pedidos de correção, comunicação de sanções e revisão devem seguir o processo de suporte/moderação já previsto nos documentos do Tâmo On.

O limite é de 10 novas denúncias por conta em 24 horas. Repetir uma denúncia ainda aberta para o mesmo registro devolve o protocolo existente. Essa proteção também evita duplicação quando ocorre uma nova tentativa após falha de rede.

## Publicação — nesta ordem

1. No SQL Editor do Supabase, execute somente `backend-migration-beta-1.0-build-162-community-safety.sql`.
2. Execute `backend-healthcheck-beta-1.0-build-162.sql`. Todos os resultados das duas tabelas devem ser `true`.
3. Na Edge Function **publish-announcement** já publicada, substitua todo o código pelo arquivo separado `publish-announcement-edge-build-115.ts` e publique. Mantenha as configurações e secrets existentes. **Não altere delete-beta-user.**
4. Extraia `Tamo-On-Build-162-INCREMENTAL.zip` e envie seu conteúdo à raiz do repositório no GitHub, preservando as pastas. Aguarde o deployment do Cloudflare.
5. Atualize o app e confirme Aplicativo/HTML/Service Worker 162 e Banco 150. A versão da Edge é conferida no código publicado; o healthcheck SQL não comprova o deployment dela.

Sim, os arquivos SQL da pasta **backend** também devem ser enviados ao GitHub. O `backend/supabase-schema.sql` é atualizado como referência; **não o execute sobre o banco existente**. Execute somente a migration incremental e depois o healthcheck. O schema histórico isolado não foi validado como instalador de um projeto novo nesta entrega.

O pacote inclui a fonte atualizada em `supabase/functions/publish-announcement/index.ts`. Enviar essa fonte ao GitHub não publica a Edge no Supabase. O arquivo separado entregue contém exatamente o mesmo código para facilitar a substituição no editor.

Não é necessário reenviar ícones, native-assets ou documentos legais. Os textos e hashes jurídicos v1.2 não foram alterados e não há novo aceite. O Código de Conduta existente já prevê denúncias e preservação de provas. Não foi criado prazo novo de retenção nem expurgo automático de denúncias; a retenção dessas evidências precisa integrar a rotina interna de moderação e revisão de necessidade antes da abertura pública.

## Testes no beta após publicar

Use duas contas de participantes (A e B), uma conta administradora da plataforma e um grupo de teste.

1. A denuncia um participante e um aviso de B. Confira o protocolo e a lista de A. B não deve ver esses relatos; um administrador apenas do grupo também não deve acessar a moderação.
2. Na conta da plataforma, abra a fila, registre Em análise e uma resposta. Confira a atualização para A. Depois conclua retirando o aviso: ele deve deixar de aparecer, inclusive na central de notificações. Teste a restauração.
3. A bloqueia B. Publique um novo aviso de B e teste um reenvio. A não deve receber esses pushes nem vê-los no app. Uma terceira conta não bloqueada deve recebê-los. Teste também um aviso de A para B.
4. Confira que os registros de presença, times e caixa continuam disponíveis. Novas avaliações entre A e B devem ser recusadas; os registros anteriores continuam intactos.
5. Envie um comunicado geral do Tâmo On: ele deve continuar chegando. Desbloqueie B, publique um aviso novo e confira a entrega. Se ambos bloquearam um ao outro, ambos precisam retirar seus próprios bloqueios.
6. Confira Denunciar em evento, grupo, notificação e convidado. Teste fechar/voltar, erro de conexão com preservação do relato e uso em iPhone e Android.
7. A suspensão de conta deve ser testada somente com uma conta de teste. A reversão continua no controle de acessos do Painel Beta. Nunca use a própria conta administradora nesse teste.

## Validação executada

- 64 verificações locais em PostgreSQL/PLpgSQL via PGlite: execução e repetição da migration, RLS, privilégios, isolamento, aceite, conta ativa, alvos autorizados, duplicação, limite diário, bloqueio recíproco, filtros de push, proteção de avaliações, decisões, restauração, suspensão, histórico e healthcheck.
- Interface real em Chromium com respostas de servidor simuladas: formulário obrigatório, falha/repetição, protocolo, bloqueio/desbloqueio, moderação, retorno, escape de conteúdo e fechamento antes do fim da consulta. Layout conferido em 320, 390 e 1280 pixels, sem zoom forçado nos campos novos.
- Código completo da Edge executado em ambiente simulado: aviso, reenvio, cobrança direta, exceção de mensagem do sistema, teste do aparelho, filtragem após inserção e falha segura quando a consulta de bloqueios falha. Nenhuma notificação real foi enviada nesses testes.
- Sintaxe, versões, consistência do SQL e integridade do pacote verificadas.

Os testes locais usam dados sintéticos e não substituem o teste no projeto publicado nem em aparelhos físicos. O advisor do Supabase não foi executado com sucesso, pois não havia instância local do Supabase; as verificações de privilégios e RLS foram realizadas diretamente no PostgreSQL de testes. Nenhum banco ou deployment de produção foi alterado nesta preparação.
