# Tâmo On Beta 1.0 — Build 142

Atualização manual que recoloca os 20 escudos antigos no aplicativo, preservando a arte, iluminação, brilho, cores e volume originais.

## Estado da versão

- Aplicativo: **Build 142**
- HTML: **Build 142**
- Service Worker: **Build 142**
- Banco: **Build 140** — sem alteração
- Edge Functions: **Build 110** — sem alteração
- Cache: **tamo-on-beta-1.0-build-142-r1**

## Tratamento aplicado aos escudos

- Os desenhos não foram refeitos nem estilizados.
- O canvas horizontal excedente foi removido.
- Cada escudo foi centralizado em canvas quadrado transparente de 512 × 512.
- Iluminação, brilho, sombras, cores e profundidade foram preservados.
- O ícone 11 recebeu limpeza adicional do fundo semitransparente residual.
- Os arquivos antigos da Build 140 não são apagados e continuam disponíveis para reversão.

## Publicação direta pelo GitHub

1. Descompacte o ZIP.
2. Abra a pasta **ARQUIVOS-PARA-GITHUB**.
3. No repositório **edolbf-collab/tamo-on**, confirme a branch **main**.
4. Clique em **Add file > Upload files**.
5. Arraste todo o conteúdo de dentro de **ARQUIVOS-PARA-GITHUB**. Não envie o ZIP nem a pasta externa.
6. Confirme os 6 arquivos da raiz e os 20 PNGs em **assets/group-avatars-build-142**.
7. Use a mensagem: **Tâmo On Beta 1.0 Build 142 - restaura escudos clássicos**.
8. Clique em **Commit changes** e aguarde os deployments do Worker e do Pages.

## Conferência após o deploy

1. Abra o app e toque em **Atualizar agora**, caso o aviso apareça.
2. Em **Mais > Sobre e diagnóstico**, confirme Aplicativo 142, HTML 142, Service Worker 142 e Banco 140.
3. Abra **Personalizar grupo** e confira os 20 escudos.
4. Feche completamente e reabra o app se o navegador ainda mostrar imagens antigas em cache.
