# Tâmo On — Build 156: correção da pesquisa do Caixa

Base: Build 155. Aplicativo, HTML e Service Worker: 156. Banco: 148. Edge: 112.

## Correção

A pesquisa aplicava o atributo `hidden` aos registros sem correspondência, mas as regras CSS `display:flex` e `display:grid` mantinham as linhas e seções visíveis. A regra de ocultação agora tem prioridade dentro da lista financeira, incluindo a mensagem de ausência de resultados.

O botão Buscar, a tecla de pesquisa e a filtragem ao digitar usam a mesma função. A pesquisa continua restrita ao mês, à aba e ao filtro selecionados. O painel separado de pendências anteriores não faz parte dessa busca.

## Publicação

Extraia o incremental e envie seus nove arquivos à raiz do GitHub, substituindo os existentes. Após o deployment, reabra o aplicativo e confirme aplicativo/HTML/Service Worker 156 e banco 148.

Não há SQL, healthcheck ou publicação de Edge Function nesta atualização.

## Validação

Foram verificados por simulação a pesquisa por nome com acento, ausência de resultados, ocultação de seções e restauração ao limpar. Sintaxe e integridade do ZIP também foram verificadas. O teste visual em navegador não pôde ser executado: o download do Chromium falhou nesta sessão.

No celular:

1. Em um mês com registros de dois membros, pesquise um deles e toque em Buscar. Somente seus registros devem aparecer.
2. Repita em Extrato e Cobranças.
3. Pesquise um nome inexistente: deve aparecer apenas a mensagem de ausência de resultados na lista.
4. Apague a busca: os registros do período e filtro selecionados devem reaparecer.
5. Confirme o mesmo comportamento usando a tecla de pesquisa do teclado.
