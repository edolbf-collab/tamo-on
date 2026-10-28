# Marketplace privado — incremental 166-R3

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
- Repetir uma sincronização não duplica jogos. Versões antigas são ignoradas. Em falha de rede, o titular pode tentar novamente.
- Nenhum valor simulado é lançado no caixa real da Comunidade. A ponte não envia avisos nem notificações automaticamente.

A sincronização ocorre ao abrir o Marketplace, depois das operações de alteração, pelo botão **Sincronizar Comunidade** e a cada minuto enquanto a tela está aberta. Não existe tarefa em segundo plano com o app fechado. O painel **Reservas de teste** mostra a última sincronização concluída. Outros grupos do sandbox continuam isolados da Comunidade.

A revisão 166-R3 autoriza duas contas de homologação adicionais: cliente e parceiro. Nenhuma delas se torna administradora da plataforma. A conta de parceiro conserva a associação à Arena Central de homologação. A ponte do Teste FC e seu painel continuam exclusivos do titular. A conta de parceiro deve primeiro entrar na Comunidade com o mesmo Google e concluir seu próprio aceite legal; o vínculo entre os projetos é estabelecido pelo servidor após essa verificação.

## Proteções

- As duas Edge Functions verificam a identidade pelo serviço Auth. A sincronização exige tokens válidos da Comunidade e do Marketplace, pertencentes às contas fixadas no servidor.
- O contexto da Comunidade exige sessão ativa, administrador, permissão de gerenciar jogos no grupo configurado e aceite legal. O navegador não fornece o snapshot de reservas que será aplicado.
- A importação e a escrita final são RPCs exclusivas de serviço. O gateway lê as reservas diretamente do Marketplace com a sessão autenticada do titular e valida o grupo de destino novamente na Comunidade.
- O Marketplace mantém o filtro de requisições e as políticas RLS restritivas do piloto 166-R1, incluindo a verificação da sessão própria. Fotos permanecem privadas e usam URLs assinadas por dez minutos.
- Tokens do Marketplace ficam em memória, fora de URLs e logs. Dados transitórios são limpos na entrada/saída. `/marketplace/` fica fora do cache offline.
- As tabelas privadas da ponte não possuem políticas de acesso direto: isso é intencional. Apenas funções controladas podem acessá-las.
- `verify_jwt=false` nas Edge Functions permite os tokens de projetos distintos; a autenticação e autorização completas são feitas dentro das funções.

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

## Roteiro no celular

1. Abrir a Comunidade com a conta autorizada e selecionar Teste FC. Conferir os jogos, presenças, times e caixa existentes.
2. Abrir **Onde jogar → Teste privado**. Conferir o aviso permanente de sandbox e escolher **Teste FC · Comunidade** como grupo da reserva.
3. Criar uma reserva futura para um evento novo. Sincronizar. Conferir o estado pendente em **Reservas de teste**, sem novo jogo no grupo.
4. Confirmar pelo fluxo de pagamento simulado do sandbox. Sincronizar. Abrir o novo jogo na Comunidade e testar presença, times e churrasco com o grupo.
5. Repetir a sincronização e verificar que não duplica. Testar alteração de horário e cancelamento em uma reserva de teste futura.
6. Testar uma reserva vinculada a jogo existente: os ajustes nativos desse jogo devem permanecer intactos.
7. Testar mensalidade/ocorrências, desconexão e tentativa posterior. Confirmar que o caixa real não recebeu lançamentos.
8. Com as contas de homologação, testar os perfis de cliente e parceiro e conferir que não aparece Administração nem sincronização do Teste FC. Com uma conta fora da lista, confirmar que o Marketplace é negado, mesmo pelo link direto. Integrantes do Teste FC continuam podendo ver os jogos publicados conforme as permissões normais.
9. Registrar resultado, aparelho, horário e evidência, sem tokens nem informações pessoais desnecessárias.

## Suspensão e reversão

Na Comunidade: `update marketplace_pilot.config set enabled=false where singleton;` bloqueia a ponte e o painel privado. No Marketplace: `update private.community_marketplace_pilot set enabled=false where singleton;` bloqueia o acesso ao piloto, inclusive do titular. Preservar tabelas e histórico.

A suspensão não apaga os jogos de teste já publicados. Para retirar a interface, restaurar o deploy anterior. Não remover indiscriminadamente RLS nem migrações. A abertura pública exige revisão própria de permissões, pagamentos e publicação nas lojas.
