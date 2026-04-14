# pdf-extractor — CLAUDE.md

## Fluxo de desenvolvimento

### Registry é a fonte da verdade

O componente principal vive em:
```
packages/registry/react/pdf-viewer/pdf-viewer.tsx
```

O painel (`plick-environments/painel`) consome uma cópia sincronizada em:
```
src/features/xlsx-extractor/components/pdf-viewer.tsx
```

**Toda mudança deve ser feita no registry primeiro.** Nunca edite diretamente o arquivo do painel.

### Sequência para qualquer mudança no PDFViewer

1. Edite `packages/registry/react/pdf-viewer/pdf-viewer.tsx`
2. Commit + push no registry (`pdf-extractor`)
3. Sincronize o painel (o usuário faz o sync após o push)

A diferença entre os dois arquivos é apenas nos imports — o conteúdo do componente deve ser idêntico.

### Diferença de imports

| registry | painel |
|---|---|
| `@pdf-extractor/types` | `../core/types` |
| `@pdf-extractor/extract` | `../core/extract` |
| `@pdf-extractor/utils` | `../../../lib/cn` |
| `@pdf-extractor/table-overlay` | `./table-overlay` |
| `@pdf-extractor/ignore-overlay` | `./ignore-overlay` |
| `@pdf-extractor/output-panel` | `./output-panel` |
| `@pdf-extractor/data-view` | `./data-view` |
| `@pdf-extractor/rules-panel` | `./rules-panel` |

## Arquitetura do PDFViewer

### Props relevantes

- `initialRules` — rules pré-carregadas (ex: de um template salvo)
- `onExtractionChange` — callback disparado quando anchors, extraction ou rules mudam; recebe `{ anchors, extraction, rules }`
- `onTemplateSave` — callback do botão "Salvar" interno; recebe o `PdfTemplate` completo com `{ anchors, extraction, rules }`

### Rules internas (`extract_variable` com `source: "pdf_region"`)

Quando o usuário desenha uma variável sobre o PDF (tool mode "variable"), o PDFViewer cria internamente uma rule do tipo:
```ts
{ type: "extract_variable", source: "pdf_region", region: PdfRegion, ... }
```

Essas rules ficam no estado interno `rules` do PDFViewer e são expostas via `onExtractionChange` e `onTemplateSave`. O consumidor (ex: `pdf-parser-button.tsx`) deve capturá-las e incluí-las no payload de save.

### Como o painel salva templates

Em `pdf-parser-button.tsx`, o `buildSavePayload` combina:
- `extractionRef.current.anchors` — anchors do PDFViewer
- `extractionRef.current.extraction` — tabelas/ignores/footers/headers
- `extractionRef.current.rules` — rules do PDFViewer (inclui `extract_variable` pdf_region)
- `currentRules.rules` — DataView rules (filtros, transformações de coluna)
- `mappings` — mapeamento de colunas (data, valor, histórico)
