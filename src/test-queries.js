import { BigQuery } from '@google-cloud/bigquery';
import { MANUAL_QUERIES } from './manual-queries.js';

const MANUAL_LIMIT = 100;
const GENERATED_LIMIT = 200;
const SKIP_CATEGORIES = /mercadolibre|outlet|sin categor/i;

function normalizeText(value) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function slugToQuery(slug) {
  return slug.replace(/-/g, ' ').trim();
}

function wordVariants(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variants = new Set([escaped]);

  if (word.endsWith('adoras')) {
    variants.add(word.slice(0, -2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    variants.add(`${word.slice(0, -3)}ad`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  } else if (word.endsWith('adores')) {
    variants.add(word.slice(0, -2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    variants.add(`${word.slice(0, -3)}ad`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  } else if (word.endsWith('es')) {
    variants.add(word.slice(0, -2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  } else if (word.endsWith('s')) {
    variants.add(word.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }

  return [...variants].join('|');
}

const CATEGORY_PATTERN_ALIASES = {
  veladores: 'lampara|velador',
  bebederos: 'bebedero|fuente|comedero',
  infladores: 'inflador|compresor|bomba',
  soldadoras: 'soldador|soldado|soldadora',
  griferias: 'griferia|canilla|ducha|monocomando|bacha',
  extractores: 'extractor(?! de agujas)(?! de terminales)(?!es de)',
  exprimidores: 'exprimidor|juguera',
  climatizadores: 'climatizador|enfriador',
  organos: 'organo|teclado|piano',
  procesadoras: 'procesador|minipimer|licuadora',
  camaras: 'camara(?!.*pila)(?! web)',
  trapeadores: 'trapeador|mopa',
  anafes: 'anafe',
  multigimnasio: 'multigimnasio',
  bolsos: 'bolso',
  transportadoras: 'transportadora|bolso',
  lingas: 'linga|traba|cadena',
  accesorios: 'microfono|lente|funda|cable|cargador|soporte',
  componentes: 'memoria|procesador|placa|disco|ram|ssd|gpu|motherboard',
  armas: 'pistola|lanzador|dardo|nerf|rifle',
  tablets: 'tablet',
  notebooks: 'notebook|laptop',
  handies: 'handy|baofeng|walkie|radio',
  memorias: 'micro sd|memoria sd|tarjeta sd|memoria',
  vasos: 'vaso|plato|cuchara|bowl|bebé|bebe',
  headset: 'headset|auricular',
};

function slugToPattern(slug) {
  const parts = slug
    .split('-')
    .filter((word) => word.length > 2)
    .map((word) => wordVariants(normalizeText(word)));

  appendCategoryAliases(parts, slug, '');

  return parts.join('|');
}

function nameToPattern(name) {
  const parts = normalizeText(name)
    .split(/[\s/]+/)
    .filter((word) => word.length > 2 && word !== 'y')
    .map((word) => wordVariants(word));

  appendCategoryAliases(parts, '', name);

  return parts.join('|');
}

function appendCategoryAliases(parts, slug, name) {
  const haystack = `${slug} ${normalizeText(name)}`;

  for (const [key, alias] of Object.entries(CATEGORY_PATTERN_ALIASES)) {
    if (haystack.includes(key)) {
      parts.push(alias);
    }
  }
}

function buildCategoryPattern(slug, name) {
  const variants = new Set([
    ...slugToPattern(slug).split('|'),
    ...nameToPattern(name).split('|'),
  ]);

  return [...variants].filter(Boolean).join('|');
}

function nameToQuery(name) {
  return normalizeText(name);
}

function categoryMatches(actual, expected) {
  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);
  const expectedRoot = normalizedExpected.split(/\s+/)[0];

  if (
    normalizedActual === normalizedExpected ||
    normalizedActual.startsWith(`${normalizedExpected} `) ||
    normalizedActual.startsWith(expectedRoot) ||
    normalizedActual.includes(expectedRoot)
  ) {
    return true;
  }

  const relatedCategories = {
    headset: ['auricular'],
    auriculares: ['headset'],
    multigimnasio: ['entrenamiento funcional'],
  };

  const related = relatedCategories[normalizedExpected];
  return related?.some((category) => normalizedActual.includes(category)) ?? false;
}

export function failureHint({ meta, top }) {
  if (!top) {
    return 'ranking';
  }

  if (top.es_accesorio === 1) {
    return 'accesorio';
  }

  if (meta?.category && !categoryMatches(top.category ?? '', meta.category)) {
    return 'catalogo';
  }

  return 'ranking';
}

export function makeMatcher({ pattern, category, mode = 'strict' }) {
  const titlePattern = new RegExp(pattern, 'i');

  const matchesText = (title, hit) =>
    titlePattern.test(normalizeText(title)) ||
    titlePattern.test(normalizeText(hit?.marca));

  return (title, cat, hit) => {
    if (!matchesText(title, hit)) {
      return false;
    }

    if (!category || mode === 'brand') {
      return true;
    }

    if (!categoryMatches(cat, category)) {
      return false;
    }

    if (mode === 'category' && hit?.es_accesorio === 1) {
      return false;
    }

    return true;
  };
}

export function normalizeQuery(entry, source) {
  return {
    q: entry.q,
    expect: makeMatcher(entry),
    meta: entry,
    source,
  };
}

function createQuerySet(limit) {
  const queries = [];
  const seen = new Set();

  function add(entry, source) {
    const key = entry.q.toLowerCase().trim();
    if (!key || seen.has(key) || queries.length >= limit) {
      return false;
    }
    seen.add(key);
    queries.push(normalizeQuery(entry, source));
    return true;
  }

  return { queries, seen, add };
}

export async function buildTestQueries(bigQueryConfig) {
  const client = new BigQuery({
    projectId: bigQueryConfig.projectId,
    credentials: bigQueryConfig.credentials,
  });

  const dataset = process.env.BIGQUERY_DATASET || 'ds_bidcom';
  const tableRef = `\`${bigQueryConfig.projectId}.${dataset}.posts\``;

  const [categories] = await client.query({
    query: `
      SELECT categoria_principal_name AS name, categoria_principal_slug AS slug, COUNT(*) AS count
      FROM ${tableRef}
      WHERE post_status = 'publish'
        AND categoria_principal_name IS NOT NULL
        AND categoria_principal_slug IS NOT NULL
      GROUP BY 1, 2
      ORDER BY count DESC
    `,
    location: bigQueryConfig.location,
  });

  const [brands] = await client.query({
    query: `
      SELECT marca AS name, COUNT(*) AS count
      FROM ${tableRef}
      WHERE post_status = 'publish' AND marca IS NOT NULL AND marca != ''
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 120
    `,
    location: bigQueryConfig.location,
  });

  const [lines] = await client.query({
    query: `
      SELECT linea AS name, COUNT(*) AS count
      FROM ${tableRef}
      WHERE post_status = 'publish' AND linea IS NOT NULL AND linea != ''
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 80
    `,
    location: bigQueryConfig.location,
  });

  const manual = createQuerySet(MANUAL_LIMIT);
  for (const entry of MANUAL_QUERIES.slice(0, MANUAL_LIMIT)) {
    manual.add({ ...entry, mode: 'strict' }, 'manual');
  }

  const generated = createQuerySet(GENERATED_LIMIT);

  for (const row of categories) {
    if (SKIP_CATEGORIES.test(row.name)) {
      continue;
    }

    const pattern = buildCategoryPattern(row.slug, row.name);

    generated.add(
      {
        q: slugToQuery(row.slug),
        pattern,
        category: row.name,
        mode: 'category',
      },
      'generated',
    );

    generated.add(
      {
        q: nameToQuery(row.name),
        pattern,
        category: row.name,
        mode: 'category',
      },
      'generated',
    );
  }

  for (const row of brands) {
    const brand = row.name.trim();
    generated.add(
      {
        q: brand.toLowerCase(),
        pattern: brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        mode: 'brand',
      },
      'generated',
    );
  }

  for (const row of lines) {
    const line = row.name.trim();
    generated.add(
      {
        q: line.toLowerCase(),
        pattern: line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        mode: 'brand',
      },
      'generated',
    );
  }

  for (const row of categories) {
    if (SKIP_CATEGORIES.test(row.name)) {
      continue;
    }

    const slugWords = row.slug.split('-').filter((word) => word.length > 3);
    for (const word of slugWords) {
      generated.add(
        {
          q: word,
          pattern: buildCategoryPattern(row.slug, row.name),
          category: row.name,
          mode: 'category',
        },
        'generated',
      );
    }
  }

  return {
    manual: manual.queries,
    generated: generated.queries.slice(0, GENERATED_LIMIT),
    all: [...manual.queries, ...generated.queries.slice(0, GENERATED_LIMIT)],
  };
}
