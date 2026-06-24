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

Ejecuta **308 búsquedas** de calidad:

- **100 manuales** — términos curados en `src/manual-queries.js`
- **200 generadas** — categorías, marcas y líneas desde BigQuery
- **8 ref_usa** — queries donde conviven SKU normales y `ref-`/`usa-`; el #1 no puede ser ref/usa si hay normales (`src/ref-usa-queries.js`)

Opciones:

```bash
SKIP_SETTINGS=true npm run test:search   # no re-aplica settings
VERBOSE=true npm run test:search         # muestra las 300 en detalle
```

### Interfaz web de búsqueda

```bash
npm run settings   # una vez: aplica filterable (marca, categoría) sin reindexar
npm run web        # http://localhost:3000
```

- Pestaña **Bidcom**: todo el catálogo (sin filtro de marca).
- Pestaña **Gadnic**: solo `marca = "Gadnic"`.
- **Categorías**: chips con conteo (facets) en la misma request que los productos.
- Orden: `sort: ['orden_web:asc']` en cada búsqueda.

### Deploy web en Vercel

Solo la UI + API (`public/` + `api/`). No corre el sync.

1. Importar repo en Vercel (Framework: Other, sin build).
2. Env vars: `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`, `MEILISEARCH_INDEX`, opcional `MEILISEARCH_SORT_FIELD`.
3. Push a `main` → redeploy automático.

Documentación completa: [`docs/DOCUMENTACION.md`](docs/DOCUMENTACION.md).

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
| `MEILISEARCH_FILTERABLE_ATTRIBUTES` | No | `marca,categoria_principal_name` | Filtros y facets en la web |
| `SYNC_BATCH_SIZE` | No | `1000` | Documentos por lote |
| `SYNC_DELETE_STALE` | No | `true` | Borra docs que ya no están en BQ |

Query por defecto (si no se define `BIGQUERY_QUERY`):

```sql
SELECT * FROM `project.ds_bidcom.posts`
WHERE post_status = 'publish'
ORDER BY orden_web ASC
```

## Configuración del índice

En cada sync se aplican searchable, displayed, filterable, ranking, sort y sinónimos. **No** incluye embedder ni búsqueda semántica.

### Searchable attributes

Campos donde Meilisearch busca texto, en orden de prioridad:

`post_title` → `categoria_principal_name` → `codigo_aguila` → `ean` → `descripcion_producto` → `marca` → …

### Displayed attributes

Campos y orden en la vista previa / respuesta de búsqueda:

`post_title`, `imagen_calada`, `precio`, `marca`, `codigo_aguila`, …

### Ranking rules

```
es_ref_usa:asc → words → typo → proximity → attributeRank → wordPosition → sort → exactness → es_accesorio:asc
```

- `es_ref_usa:asc` va **primera**: ningún SKU `ref-`/`usa-` queda arriba de un producto normal, sin importar relevancia ni `orden_web`.
- Después gana la **relevancia textual** y el **`sort`** con `orden_web`.
- `es_accesorio:asc` deja accesorios debajo de productos principales (entre los no ref/usa).

### Sortable y filterable

- **Sortable:** `orden_web`, `es_ref_usa`, `es_accesorio`
- **Filterable:** `marca`, `categoria_principal_name` (pestañas Gadnic y chips de categoría)

## Normalización de documentos

Durante el sync cada fila se transforma antes de subirse:

| Campo | Tratamiento |
|---|---|
| `ID` | Convertido a string (BigQuery NUMERIC) |
| `orden_web` | Numérico; `null` → `9999` |
| `imagen_calada` | Si viene vacío, se extrae del JSON `fields` (URL `1000x1000`) |
| Fechas | ISO string |
| NUMERIC de BQ | String entero |
| `es_accesorio` | `1` si el título parece accesorio, `0` si no |
| `es_ref_usa` | `1` si `codigo_aguila` empieza con `ref-` o `usa-`, `0` si no |

## Búsqueda semántica (embedder) — no activa

Hoy el índice funciona solo con **búsqueda por texto**. No hay embedder ni `hybrid` en la web.

Para el catálogo Bidcom (queries cortas, marcas, categorías, `orden_web`) **no es relevante por ahora**. Podría evaluarse más adelante si se priorizan búsquedas en lenguaje natural; implicaría configurar el embedder en Meilisearch Cloud, usar `hybrid` en el frontend y asumir costo/latencia de indexación.

El sync **no** configura embedder. Referencia de template si algún día se activa:

```
Producto: {{ doc.post_title }}. SKU: {{ doc.codigo_aguila }}. Marca: {{ doc.marca }}. Categoría: {{ doc.categoria_principal_name }}. Línea: {{ doc.linea }}. EAN: {{ doc.ean }}. Descripción: {{ doc.descripcion_producto | truncatewords: 40 }}
```

## Estructura del proyecto

```
api/                   # Serverless Vercel (search, health)
public/                # UI del buscador
src/
├── index.js           # Entry point del sync + scheduler
├── apply-settings.js  # npm run settings
├── config.js          # Env vars y defaults del índice
├── bigquery.js
├── meilisearch.js
├── sync.js
├── manual-queries.js
├── test-queries.js
├── test-search.js
└── web/               # Lógica compartida local + Vercel
docs/
└── DOCUMENTACION.md
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

Verificá `es_accesorio:asc` y `es_ref_usa:asc` en ranking rules y que la búsqueda use `sort: ['orden_web:asc']`. Corré `npm run test:search`.

### SKUs ref- / usa- arriba del producto principal

Verificá que `es_ref_usa:asc` sea la **primera** ranking rule y corré `npm run settings`.

### Filtros / categorías no funcionan en la web

Corré `npm run settings` (o `npm run sync`) para aplicar `filterableAttributes: ['marca', 'categoria_principal_name']`.

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
