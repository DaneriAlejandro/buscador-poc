# meilisearch-sync

Sincronizador en Node.js que carga productos desde **BigQuery** al índice **`productos-BQ`** de **Meilisearch Cloud**, con configuración de relevancia, orden web e imágenes.

Pensado para el catálogo de Bidcom: tabla `posts` en `ds_bidcom`, productos publicados de WordPress replicados en BigQuery.

## Qué hace

1. Lee productos publicados desde BigQuery (`post_status = 'publish'`).
2. Normaliza documentos (IDs, fechas, `orden_web`, imágenes).
3. Configura el índice de Meilisearch (searchable, displayed, ranking, sort).
4. Hace upsert por lotes.
5. Opcionalmente elimina documentos que ya no existen en la fuente.

## Requisitos

- Node.js **20+**
- Service account de GCP con acceso de lectura a BigQuery
- Instancia de Meilisearch (Cloud o self-hosted) con API key

## Instalación

```bash
git clone <repo>
cd meilisearch-sync
npm install
cp .env.example .env
```

Completá `.env` con credenciales reales. **No commitear `.env`** (ya está en `.gitignore`).

## Uso

### Sincronización completa

```bash
npm run sync
```

Tarda unos **4–6 minutos** para ~21.600 productos (lectura BigQuery + upsert en lotes). Muestra progreso por batch.

### Tests de búsqueda

```bash
npm run test:search
```

Ejecuta **300 búsquedas** de calidad:

- **100 manuales** — términos curados en `src/manual-queries.js`
- **200 generadas** — categorías, marcas y líneas desde BigQuery

Opciones:

```bash
SKIP_SETTINGS=true npm run test:search   # no re-aplica settings
VERBOSE=true npm run test:search         # muestra las 300 en detalle
```

## Variables de entorno

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `BIGQUERY_CREDENTIALS_JSON` | Sí | — | JSON completo de la service account |
| `BIGQUERY_DATASET` | Sí | — | Dataset (`ds_bidcom`) |
| `BIGQUERY_TABLE` | Sí | — | Tabla (`posts`) |
| `BIGQUERY_QUERY` | No | ver abajo | Query SQL custom |
| `BIGQUERY_LOCATION` | No | `US` | Región de ejecución |
| `MEILISEARCH_HOST` | Sí | — | URL de Meilisearch |
| `MEILISEARCH_API_KEY` | Sí | — | API key |
| `MEILISEARCH_INDEX` | Sí | — | Índice destino (`productos-BQ`) |
| `MEILISEARCH_PRIMARY_KEY` | No | `id` | Campo ID (`ID`) |
| `MEILISEARCH_SORT_FIELD` | No | `orden_web` | Campo de prioridad web |
| `MEILISEARCH_SEARCHABLE_ATTRIBUTES` | No | ver `config.js` | Lista separada por comas |
| `MEILISEARCH_DISPLAYED_ATTRIBUTES` | No | ver `config.js` | Orden de campos en resultados |
| `SYNC_BATCH_SIZE` | No | `1000` | Documentos por lote |
| `SYNC_DELETE_STALE` | No | `true` | Borra docs que ya no están en BQ |

Query por defecto (si no se define `BIGQUERY_QUERY`):

```sql
SELECT * FROM `project.ds_bidcom.posts`
WHERE post_status = 'publish'
ORDER BY orden_web ASC
```

## Configuración del índice

En cada sync se aplican estos settings (no borran el embedder de OpenAI si está configurado en la UI).

### Searchable attributes

Campos donde Meilisearch busca texto, en orden de prioridad:

`post_title` → `categoria_principal_name` → `codigo_aguila` → `ean` → `descripcion_producto` → `marca` → …

### Displayed attributes

Campos y orden en la vista previa / respuesta de búsqueda:

`post_title`, `imagen_calada`, `precio`, `marca`, `codigo_aguila`, …

### Ranking rules

```
words → typo → proximity → attributeRank → wordPosition → exactness → orden_web:asc → sort
```

- Primero gana la **relevancia textual** (título exacto, posición de palabras).
- Después desempata **`orden_web`** (1 = más prioridad en la web, 9999 = sin prioridad).

### Sortable

- `orden_web` — para ordenar explícitamente: `sort: ['orden_web:asc']`

## Normalización de documentos

Durante el sync cada fila se transforma antes de subirse:

| Campo | Tratamiento |
|---|---|
| `ID` | Convertido a string (BigQuery NUMERIC) |
| `orden_web` | Numérico; `null` → `9999` |
| `imagen_calada` | Si viene vacío, se extrae del JSON `fields` (URL `1000x1000`) |
| Fechas | ISO string |
| NUMERIC de BQ | String entero |

## Embedder (búsqueda semántica)

El sync **no modifica ni borra** la configuración del embedder. Solo actualiza searchable, displayed, ranking y sort.

Template recomendado para OpenAI en Meilisearch Cloud:

```
Producto: {{ doc.post_title }}. SKU: {{ doc.codigo_aguila }}. Marca: {{ doc.marca }}. Categoría: {{ doc.categoria_principal_name }}. Línea: {{ doc.linea }}. EAN: {{ doc.ean }}. Descripción: {{ doc.descripcion_producto | truncatewords: 40 }}
```

## Estructura del proyecto

```
src/
├── index.js           # Entry point del sync
├── config.js          # Env vars y defaults del índice
├── bigquery.js        # Lectura desde BigQuery
├── meilisearch.js     # Cliente, settings, upsert, delete stale
├── sync.js            # Orquestación y normalización
├── manual-queries.js  # 100 búsquedas manuales de prueba
├── test-queries.js    # Generador de 200 búsquedas desde catálogo
└── test-search.js     # Runner de tests de relevancia
```

## Flujo de sincronización

```
BigQuery (posts)
    │
    ▼
fetchRows() ──► normalizeDocument() ──► ensureIndex() (settings)
    │
    ▼
upsertDocuments() por lotes
    │
    ▼
deleteStaleDocuments() (opcional)
    │
    ▼
Índice productos-BQ en Meilisearch
```

## Troubleshooting

### Timeout en Meilisearch

Los documentos son pesados (~7 KB c/u por el JSON `fields`). Si falla con timeout:

- Bajá `SYNC_BATCH_SIZE` (ej. `500`)
- El cliente ya usa timeout de 5 min por tarea

### Imágenes que no se ven

Meilisearch muestra `imagen_calada`. El sync la completa desde `fields` si viene vacía en BigQuery. Productos sin foto en ningún lado (ej. cupones) no tendrán imagen.

### Accesorios arriba del producto real

Verificá el orden de ranking rules. `orden_web:asc` debe ir **después** de `wordPosition` y `exactness`. Corré `npm run test:search` para validar.

### `displayedAttributes` tarda mucho

Actualizar displayed en ~21k docs puede tardar varios minutos. Podés aplicarlo solo:

```bash
node -e "
import { loadConfig } from './src/config.js';
import { MeiliSearch } from 'meilisearch';
const c = loadConfig();
const client = new MeiliSearch({ host: c.meilisearch.host, apiKey: c.meilisearch.apiKey, defaultWaitOptions: { timeout: 600000 } });
await client.index(c.meilisearch.indexName).updateDisplayedAttributes(c.meilisearch.displayedAttributes).waitTask();
console.log('done');
"
```

## Licencia

Proyecto privado — uso interno Bidcom.
