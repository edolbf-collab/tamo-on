# Tâmo On — Build 159: recuperação do aceite

Base: Build 158 já instalada. Aplicativo, HTML e Service Worker 159; banco 149; publish-announcement 114; delete-beta-user 106.

## Comportamento

O aceite passa a tratar uma falha de conexão como um resultado que precisa ser conferido: a resposta pode ter se perdido depois de o banco salvar a confirmação.

- No fluxo normal, é feito apenas o envio do aceite.
- Após falha transitória ou resposta incompleta, o app consulta o estado do aceite no servidor.
- Se o registro estiver confirmado e a exigência estiver ativa, o app continua automaticamente, sem outro clique ou gravação.
- Se a consulta confirmar que o acesso ainda não está liberado, há no máximo um reenvio automático por clique. O reenvio utiliza exatamente os documentos e declarações selecionados pelo usuário.
- Se a consulta também falhar, o app interrompe o reenvio, mantém os campos selecionados e oferece “Verificar e continuar”. Esse botão confere primeiro o estado salvo antes de decidir por um novo envio.
- Cada requisição de envio ou conferência tem limite de 12 segundos. Uma tentativa pode envolver mais de uma requisição, mas não há repetição infinita.
- Enquanto o envio é processado, os campos ficam bloqueados para impedir mudanças nas declarações no meio da operação. Falhas recuperáveis tornam os campos editáveis novamente.
- Erros de sessão e documentos desatualizados pedem reabertura do app; não provocam reenvio automático.
- Mensagens de conexão são apresentadas em português, sem exibir diretamente “Load failed”.
- A versão registrada no aceite vem da versão executada do aplicativo: novos registros desta build informam 159.

O acesso continua dependente da resposta do banco e das verificações da inicialização. Marcar caixas localmente ou ficar offline não libera o aplicativo. A exigência de 18 anos e as três declarações obrigatórias permanecem.

A função existente no banco já impede duplicar os aceites dos mesmos documentos. Repetir a chamada preserva as datas e provas originais, inclusive a versão do aplicativo em que foram registradas. Esta atualização não reescreve aceites antigos nem exige novo aceite de quem já confirmou os documentos atuais.

## Publicação

1. Extraia `Tamo-On-Build-159-INCREMENTAL.zip`.
2. Envie os nove arquivos à raiz do repositório no GitHub, preservando a pasta `legal`.
3. Aguarde o deployment do Cloudflare e atualize o app.
4. Confirme aplicativo, HTML e Service Worker 159. O banco permanece 149.

Não há migration, alteração de schema ou novo healthcheck SQL nesta build: a correção é no aplicativo. Não é necessário executar SQL, reativar documentos ou republicar Edge Functions. Mantenha as Edges publish-announcement 114 e delete-beta-user 106 já utilizadas pela linha de base.

## Conferência no iPhone

Use uma conta do beta que ainda não tenha registrado o aceite dos documentos vigentes. Marque a maioridade e as três declarações, toque uma vez em “Aceitar e continuar” e aguarde.

- Com conexão normal, deve registrar e abrir o app.
- Se ocorrer falha transitória, poderá aparecer “Conferindo se sua confirmação já foi salva…” e, quando necessário, uma tentativa automática.
- Se a conexão continuar indisponível, os campos devem continuar selecionados e o botão deve mudar para “Verificar e continuar”. Após recuperar a conexão, use esse botão.
- Uma conta que já possui aceite válido deve entrar normalmente, sem precisar repetir a confirmação.

## Validação

23 verificações de interface em Chromium com serviços simulados: envio normal, versão 159, falhas antes e depois da gravação, consulta indisponível, limite de reenvios, tentativa manual, resposta incompleta, requisição sem resposta, documentos desatualizados, sessão expirada, menoridade, campos obrigatórios e bloqueio de duplo envio.

Em PostgreSQL isolado, foram verificadas a consulta antes/depois do aceite, a gravação da versão 159, a preservação exata dos três registros após reenvio e a separação entre contas. A tela de recuperação foi inspecionada em largura de 390 px. Sintaxe e integridade do ZIP verificadas.

Não houve alteração no Supabase publicado nem teste em um iPhone físico nesta etapa. A correção trata o comportamento reproduzido localmente; não determina qual falha de rede ocorreu no aparelho relatado.
