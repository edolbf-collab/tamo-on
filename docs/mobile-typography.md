# Rótulos e valores no mobile — 13/11/2026

## Causa e correção
O console administrativo compartilhado usava três colunas e `overflow-wrap:anywhere` no celular. Isso permitia partir Mensalidades, Configurações oficiais, Participações e Notificações dentro da palavra. Indicadores financeiros, métricas e devoluções também permitiam quebrar valores ou truncá-los com reticências.

`marketplace/mobile-layout.css` é carregado por último nas duas entradas web e incluído no pacote nativo pelo build existente. As regras se limitam a telas de até 900 px; desktop maior permanece inalterado.

- Navegação administrativa, gestão diária e ações de reservas: botões mantêm os rótulos completos, distribuindo-se por linhas conforme sua largura intrínseca.
- Métricas, resumo financeiro do parceiro, devoluções, caixa e estatísticas da comunidade: grades passam a menos colunas conforme a largura do próprio contêiner. Moeda, sinal, separadores e centavos permanecem juntos.
- Reservas, cotas, mensalidades, estados e controles de período: retirada da quebra arbitrária nos rótulos fixos, com redistribuição dos controles.
- Textos livres, descrições, mensagens, nomes e identificadores continuam com suas regras específicas. Não se aplica nowrap global ao aplicativo.
- Valores extraordinariamente extensos ou texto ampliado podem ser percorridos horizontalmente dentro do valor; nunca recebem reticências nem são cortados do dado. Os casos de até R$ 1.234.567,89, inclusive negativos, são testados para caber integralmente.

## Verificação
`mobile/tests/mobile-typography.mjs` usa CSS de produção e os renderizadores reais de administração, métricas e resumo financeiro, com dados sintéticos. Os demais cartões são reproduções dos componentes existentes. Verifica linhas, largura do texto, limites da tela, ausência de reticências e funcionamento da navegação em 320, 360, 375, 390, 430, 600, 768 e 844 px. Compara o desktop antes/depois e confere os arquivos do pacote nativo.

O workflow Mobile typography validation executa em Chromium e WebKit. A conferência visual local também cobre os dois módulos. Isso não substitui a aprovação no aparelho físico antes de enviar a próxima versão às lojas.

Publicação: web primeiro, conforme fluxo combinado. Nenhuma mudança de banco de dados, pagamento, permissão ou envio às lojas.
