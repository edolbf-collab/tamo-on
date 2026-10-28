# Marketplace privado — incremental 166-R6

Integração da Comunidade build 164 com o Marketplace 0.2.0, base consolidada 22BB-C39-R1. Inclui o piloto 166-R1 e a sincronização com o grupo Teste FC. O motor de reservas, mensalidades, parceiros e financeiro do sandbox foi preservado.

## Acesso e ambientes

| Componente | Destino e limite |
| --- | --- |
| Comunidade | Projeto existente `xvwgrpnioaqyijhzqxqh`; escrita da ponte somente no grupo Teste FC |
| Marketplace | Staging `owybghlwcohfyapvsfdo` |
| Contas autorizadas | Titular e duas contas de homologação (cliente e parceiro), em lista privada no servidor |
| Grupo conectado | Teste FC, exibido no Marketplace como Teste FC · Comunidade |
| Integrantes do grupo | Usam presença, times, convidados e churrasco normalmente; não recebem acesso ao Marketplace |
| Pagamentos e e-mails automáticos | Dinheiro real e e-mails automáticos desativados no servidor |

A interface 166-R2 foi incorporada à `main` e publicada em `app.tamoon.app.br` em 28/10/2026, após autorização do titular. `supabase-config.js` e a branch iOS 165 foram preservados.

## Fluxos conectados

- A entrada pela Comunidade reutiliza a identidade Google verificada de cada conta autorizada. Cliente e parceiro preservam seus próprios perfis e permissões. Somente o titular importa e sincroniza o grupo permitido, sem copiar os perfis dos outros integrantes para o Marketplace.
- Reserva para evento novo em `standby_payment`: aparece no painel privado de reservas; ainda não cria um jogo visível no grupo.
- Reserva confirmada no sandbox e evento publicado: cria um jogo nativo para cada ocorrência futura, com o título `[TESTE Marketplace] …`. O grupo pode usar suas interações habituais nesse jogo.
- Mensalidades usam as ocorrências emitidas pelo motor C39. A ponte não recalcula vencimentos, valores ou financiamento.
- Alterações de horário/local e cancelamentos atualizam somente jogos futuros criados pela ponte. Presenças, times, churrasco e demais configurações nativas são preservados. Jogos passados permanecem no histórico.
- Reserva vinculada a um jogo já existente: mantém a referência, sem sobrescrever ou cancelar o jogo criado manualmente na Comunidade.
- Repetir uma sincronização não duplica jogos. Versões antigas são ignoradas. Em falha de rede, a entrega automática tenta novamente; o titular também dispõe de uma tentativa manual de diagnóstico.
- Nenhum valor simulado é lançado no caixa real da Comunidade. A ponte não envia avisos nem notificações automaticamente.

A revisão 166-R5 entrega alterações pelo servidor, mesmo com o app fechado. Mudanças de reservas, ocorrências e eventos do titular no Teste FC incrementam uma fila persistente. Uma tarefa verifica a fila a cada dez segundos; falhas usam novas tentativas com intervalo crescente, até cinco minutos. O resumo privado continua acessível em **Ajuda → Diagnóstico do grupo de teste**, junto da tentativa manual de recuperação. Não há botão de sincronização no cabeçalho. Outros grupos do sandbox continuam isolados da Comunidade.

A revisão 166-R3 autoriza duas contas de homologação adicionais: cliente e parceiro. Nenhuma delas se torna administradora da plataforma. A conta de parceiro conserva a associação à Arena Central de homologação. A ponte do Teste FC e seu painel continuam exclusivos do titular. A conta de parceiro deve primeiro entrar na Comunidade com o mesmo Google e concluir seu próprio aceite legal; o vínculo entre os projetos é estabelecido pelo servidor após essa verificação.

## Proteções

- As Edge Functions de entrada e diagnóstico verificam a identidade pelo serviço Auth. A sincronização manual exige tokens válidos da Comunidade e do Marketplace, pertencentes às contas fixadas no servidor. A entrega automática usa uma rota separada autenticada por HMAC, descrita abaixo.
- O acesso interativo à Comunidade exige sessão ativa, administrador, permissão de gerenciar jogos no grupo configurado e aceite legal. O navegador não fornece o snapshot de reservas que será aplicado.
- A importação e a escrita final são RPCs exclusivas de serviço. O gateway lê as reservas diretamente do Marketplace com a sessão autenticada do titular e valida o grupo de destino novamente na Comunidade.
- O Marketplace mantém o filtro de requisições e as políticas RLS restritivas do piloto 166-R1, incluindo a verificação da sessão própria. Fotos permanecem privadas e usam URLs assinadas por dez minutos.
- Tokens do Marketplace ficam em memória, fora de URLs e logs. Dados transitórios são limpos na entrada/saída. `/marketplace/` fica fora do cache offline.
- As tabelas privadas da ponte não possuem políticas de acesso direto: isso é intencional. Apenas funções controladas podem acessá-las.
- `verify_jwt=false` nas funções de acesso permite os tokens de projetos distintos; a autenticação e autorização completas são feitas dentro das funções. Na rota de entrega, a assinatura HMAC é verificada no banco antes de qualquer escrita; o navegador não recebe a chave.

Os advisors foram consultados após as migrações. Os avisos sobre [tabelas privadas sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) e [funções SECURITY DEFINER autenticadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) são cobertos pelos bloqueios de schema, permissões explícitas, `search_path` fixo e testes de identidade. Permanecem avisos anteriores dos projetos, fora do escopo deste incremental; isto não constitui auditoria de toda a plataforma.

## Correção de acesso instalado — 166-R3

Em 28/10/2026 os logs mostraram o iPhone executando JavaScript 166 e recebendo HTTP 403 na verificação do piloto, enquanto o desktop recebia 200. Os logs anteriores não registravam o motivo específico; portanto, não foi possível atribuir aquela recusa a uma única condição do servidor.

- A autorização geral passa pela lista privada de contas, sem exigir que cliente e parceiro sejam administradores.
- A verificação do navegador usa timeout compatível com WebKit, renova sessão após 401 e tenta novamente após falha transitória, retorno ao app e reconexão. Respostas atrasadas de outra conta são descartadas.
- A origem de produção antiga `resenhafc-beta.pages.dev`, que entrega o mesmo app, é aceita junto do domínio oficial; origens desconhecidas continuam negadas.
- Os motivos de recusa são registrados sem tokens. A tela Sobre identifica a revisão 166-R3; o service worker usa novo cache.
- Contas autorizadas sem grupo também recebem a entrada Onde jogar. Botões de sincronização ficam restritos à capacidade concedida ao titular pelo servidor.
- O AAB 1.0.166 continua válido porque carrega a web publicada. Nenhum código nativo ou configuração de assinatura mudou nesta revisão.

## Implantação

1. As migrações e as funções de backend desta pasta e de `integration/community/` foram aplicadas em 28/10/2026, nos projetos correspondentes. A revisão R3 adiciona `private.marketplace_pilot_accounts` somente no Marketplace staging; a autorização das duas contas é feita por operação administrativa explícita, sem alterar seus perfis. O grupo Teste FC e as duas identidades do titular já estão configurados. Não reaplicar migrações históricas C39 nem executar os arquivos no projeto errado.
2. O frontend já foi publicado no domínio da Comunidade, reutilizando sua sessão Google. A prévia de outra origem não herda esse login e pode exigir configuração de OAuth.
3. No ZIP incremental, copiar o conteúdo de `web/` para a raiz da aplicação, preservando os demais arquivos. A pasta `integracao/` contém fontes e documentação de backend, não é uma aplicação independente. O manifesto permite conferir os arquivos e as versões de origem.
4. O wrapper Android existente carrega o site hospedado. Publicar apenas um AAB não publica estes arquivos web. Este pacote não contém um novo AAB nem publica uma versão na loja.
5. As propostas de documentação do Google Play estão em `PLAY-CONSOLE.md`; não foram enviadas ao Console. Uma conta de revisão dedicada precisa estar configurada antes de submeter a funcionalidade à revisão.

## Validação executada

Na R3, 38 testes Node passaram, cobrindo também a revalidação após suspensão/falha, troca de conta, autorização de cliente/parceiro sem privilégios administrativos e ausência de importação/sincronização para essas contas. Os testes SQL de acesso e de papéis passaram com rollback; os testes que exigem sessão usam apenas sessões existentes, sem criar sessões Auth artificiais. A primeira sessão da conta de parceiro na Comunidade e o teste físico no iPhone dependem do titular.

O teste visual em navegador não pôde ser repetido nesta sessão: Chromium foi bloqueado pelo ambiente e o WebKit local não tinha bibliotecas necessárias. Os testes de fluxo JavaScript foram executados com Auth e DOM simulados; não representam um teste em iPhone físico.

- 22 testes históricos da R2: autenticação, conta exclusiva, aceite legal, importação do grupo, dupla identidade, snapshots controlados pelo servidor, falhas e origens permitidas.
- Teste transacional na Comunidade: pendência não publica, confirmação publica, repetição não duplica, cancelamento preserva configurações, versão antiga é rejeitada, outro grupo é bloqueado, jogo manual é preservado e sessão revogada é bloqueada.
- Teste transacional no Marketplace: importação idempotente, limite por grupo, reserva criada pelo fluxo C39 real e exportação dos estados pendente, confirmado e cancelado. A confirmação nesse teste foi simulada no banco, sem cobrança ao provedor.
- Ambos os testes SQL terminaram com rollback: nenhum jogo, reserva ou cobrança de exemplo foi mantido.
- Navegador a 390 × 844: visitante e conta negada bloqueados; titular simulado carrega a interface, sincroniza e perde o acesso ao sair. Integrações remotas simuladas nesse teste de interface.
- A validação prática com Google, telefone e grupo ainda será realizada pelo titular na interface publicada.

Para repetir os testes Node: `cd integration/marketplace`, `npm install`, `npx playwright install chromium`, `npm test`, `npm run test:browser`. Os testes SQL são exclusivos dos respectivos ambientes: `tests/export.sql` no Marketplace e `../community/test-sync.sql` na Comunidade. Eles usam transação e rollback. Não transformar os dados de teste em migrações.

## Roteiro no celular — 166-R5

1. Abrir a Comunidade com uma das três contas autorizadas. Conferir a revisão **166-R5** em Sobre.
2. Tocar na única entrada **Onde jogar, quadras e reservas**. A área do usuário abre em Buscar quadras. O botão **Voltar** retorna à Comunidade mantendo a conta conectada.
3. No iPhone instalado, abrir ajuda, detalhes, agenda, formulário de reserva e chat. Conferir a margem abaixo do relógio, a rolagem interna e a área acima do indicador inferior. Repetir em paisagem e com teclado aberto.
4. Como titular, escolher **Teste FC · Comunidade**, criar reserva futura e confirmar pelo fluxo sandbox. Aguardar a entrega automática, voltar à Comunidade e conferir o jogo. Testar também fechando o Marketplace imediatamente após a confirmação; não é necessário manter a página aberta.
5. Conferir pendências pelo resumo em **Ajuda → Diagnóstico do grupo de teste**. Uma pré-reserva pendente não cria jogo no grupo. Repetir atualização não deve duplicar jogos.
6. Testar alteração de horário, cancelamento, mensalidade e reserva vinculada a jogo manual. Presenças, times, churrasco, histórico e caixa real devem permanecer preservados.
7. Nas contas cliente e parceiro, conferir os próprios papéis e ausência do diagnóstico do titular. Outra conta deve continuar bloqueada, inclusive por URL direta.
8. Conferir a ajuda prática e a ausência de **Nova reserva** em Minhas reservas. Fazer novas reservas pela agenda em Buscar quadras.
9. Registrar aparelho, horário e resultado, sem tokens. Avaliação do parceiro e distância ficam para outra etapa.

## Experiência e entrega automática — 166-R5

- Uma entrada na Comunidade e retorno com **Voltar**, sem encerrar o login da Comunidade. O token temporário do Marketplace é encerrado apenas localmente.
- Dezessete arquivos JavaScript passam a um pacote com hash de conteúdo. `npm run build` recria o pacote e o manifesto. Os arquivos-fonte permanecem no repositório para manutenção. Executar esse comando sempre que um deles mudar.
- A Comunidade pode antecipar o carregamento somente desse pacote público após a autorização de acesso e quando a economia de dados não está ativa. Não antecipa consultas de reservas, credenciais nem pagamentos. A importação do grupo e o carregamento de assets ocorrem em paralelo; a autorização continua obrigatória.
- HTML e manifesto não são armazenados; o pacote com hash pode usar cache HTTP persistente. O Marketplace continua fora do cache offline do service worker da Comunidade. A autenticação e a rede ainda geram tempo de espera; não foi feita medição em iPhone físico.
- Diálogos móveis usam `safe-area-inset-*` e altura dinâmica de viewport, com rolagem interna. A ajuda foi reescrita para orientar reservas, pagamentos, cotas, chat, cancelamentos e retorno.

A migração `automatic_pilot_delivery` instala a fila privada e o cron `tamoon-community-sync` no Marketplace staging. A migração `automatic_pilot_receiver` instala a aplicação idempotente e os recibos na Comunidade; `pilot_delivery_edge_auth` restringe a RPC receptora a `service_role`. A função Edge **community-marketplace-delivery** recebe o envelope e chama essa RPC com a credencial do próprio servidor. O aceite legal das rotas de usuários permanece obrigatório e não foi alterado.

A assinatura SHA-256/HMAC usa uma chave de 256 bits provisionada no Vault dos dois projetos, chamada `tamoon_community_sync_hmac_v1`. Essa chave não está nos arquivos nem no frontend. O receptor verifica assinatura, validade de cinco minutos, nonce e as identidades/grupo fixados na configuração. Recibos impedem repetição; o avanço da versão entregue preserva mudanças que chegaram durante a transmissão. A origem dos dados é o snapshot do banco do Marketplace, nunca o navegador.

Validação R5: 47 testes Node passaram, incluindo acesso restrito, mudança de conta durante carregamento, retorno com falha de rede, pré-carregamento restrito ao pacote público e autenticação da entrega. Testes SQL com rollback cobriram assinatura/repetição/expiração/escopo, fila concorrente, retentativa, cancelamento e preservação de jogos manuais. Uma entrega real entre os servidores, com snapshot vazio, foi recebida e confirmada; a fila ficou sem pendências ou falhas. Não foram mantidos jogos ou cobranças sintéticos.

Os advisors posteriores acrescentaram somente dois informes de RLS sem políticas, um por nova tabela privada, intencionalmente inacessíveis aos clientes. Os avisos anteriores permanecem fora do escopo. A validação visual em iPhone físico ainda é necessária; a restrição do ambiente impediu repetir o teste de navegador local.

## Suspensão e reversão

Na Comunidade: `update marketplace_pilot.config set enabled=false where singleton;` bloqueia a ponte e o painel privado. No Marketplace: `update private.community_marketplace_pilot set enabled=false where singleton;` bloqueia o acesso ao piloto, inclusive do titular. Preservar tabelas e histórico.

Para suspender somente a entrega automática, sem fechar o Marketplace: `update private.community_sync_delivery set enabled=false where singleton;`. Para retomar: `update private.community_sync_delivery set enabled=true,next_attempt_at=now() where singleton;`. Alterações acumuladas permanecem na fila.

A suspensão não apaga os jogos de teste já publicados. Para retirar a interface, restaurar o deploy anterior. Não remover indiscriminadamente RLS nem migrações. A abertura pública exige revisão própria de permissões, pagamentos e publicação nas lojas.

## Ajustes após validação no iPhone — 166-R6

- Voltar retangular, controles de notificações/som/tema/ajuda compactos em uma única linha. Ícones mantêm nomes acessíveis e contador de notificações. O texto não extrapola o botão.
- O retorno apresenta uma transição para a Comunidade antes de encerrar a sessão temporária do Marketplace. Eventos Auth e renderizações tardias não apresentam o antigo formulário de login durante a saída.
- Reservas e cotas compartilham cartões mais compactos: data pequena, status junto ao título, demais informações usando toda a largura e ações em duas colunas com quebra de texto. Prazos, valores e avisos permanecem visíveis. O estado sem evento vinculado aparece uma única vez.
- A entrada por `?page=discover` apresenta o catálogo autenticado antes das consultas complementares de financeiro, reservas e administração. Navegação, troca de papel e ações aguardam os dados completos; nenhuma reserva/pagamento usa um snapshot parcial. Conta bloqueada e modo de consulta de parceiro não usam essa apresentação antecipada. Fotos carregam em paralelo às consultas complementares.
- Os logs anteriores mostravam cerca de 0,85 s na função de acesso e 1,63 s na RPC principal, além das consultas adicionais. São tempos do servidor, não uma medição ponta a ponta do celular. O tempo relatado de 10–12 segundos não foi atribuído somente ao download dos scripts.
- As medidas locais `marketplace-entry` e `marketplace-details-ready` permitem distinguir a abertura da busca da conclusão dos dados adicionais; não enviam informações pessoais. O pré-carregamento consome o corpo do pacote para concluir o cache. O build conserva o pacote da revisão imediatamente anterior para transições de deploy.
- Validação: 54 testes Node passaram, incluindo catálogo antecipado, bloqueio de ações até completar dados, contas bloqueadas, modo de consulta, troca de identidade durante carregamento, retorno e duplicação de estado. O navegador local permaneceu indisponível; a conferência visual em iPhone físico deve ser feita na revisão publicada.

Esta revisão não altera migrações, pagamentos, sincronização automática, lista de acesso ou `supabase-config.js`. Avaliação e distância continuam adiadas.
