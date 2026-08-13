# Atualização dos ícones 3D — iOS e Android

Esta atualização substitui somente os assets de ícone. Não altera código funcional, banco, Edge Functions ou número da Build 143.

## Arte aprovada

- Símbolo oficial Tâmo On com acabamento em esmalte 3D esmeralda.
- Contorno preto para melhorar a definição em tamanhos pequenos.
- Matriz transparente preservada em `native-assets/master/tamo-on-icon-3d-master-transparent.png`.

## iOS

- O catálogo `native-assets/ios/AppIcon.appiconset` foi atualizado em todos os 18 tamanhos.
- Os arquivos finais do AppIcon são opacos, como exigido para publicação tradicional na App Store.
- O símbolo 3D foi aplicado sobre fundo institucional escuro, sem arredondamento incorporado; o sistema aplica a máscara final.

## Android

- `native-assets/android/drawable-nodpi/ic_launcher_foreground.png` contém somente o símbolo 3D com transparência real.
- O fundo permanece separado em `native-assets/android/values/colors.xml` com a cor institucional `#09251F`.
- Os ícones legados quadrados e redondos foram atualizados em `mdpi`, `hdpi`, `xhdpi`, `xxhdpi` e `xxxhdpi`.
- Os XMLs de ícone adaptativo existentes foram preservados.

## PWA e atalhos

Também foram atualizados os ícones PWA, Apple Touch e favicon já usados pelo projeto. As referências receberam o marcador `icon3dr1` apenas para vencer o cache imutável dos ícones antigos; isso não altera funcionalidades nem o número da Build 143.

## Publicação manual

1. Extraia o ZIP.
2. Envie as pastas e arquivos extraídos para a raiz do repositório GitHub, mantendo a estrutura de diretórios.
3. Permita a substituição dos arquivos existentes.
4. Faça o commit na branch `main`.

Não há arquivos SQL nem Edge Functions nesta atualização.
