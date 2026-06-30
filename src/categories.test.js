import {
  buildCategoryTaxonomy,
  normalizeCategoryName,
  resolveCategory,
} from './categories.js';

const rows = [
  {
    categoria_principal_slug: 'tablets',
    categoria_principal_name: 'Tablets',
  },
  {
    categoria_principal_slug: 'tablets',
    categoria_principal_name: 'Tablets ',
  },
  {
    categoria_principal_slug: 'pavas-electricas',
    categoria_principal_name: 'Pavas Electricas',
  },
  {
    categoria_principal_slug: 'pavas-electricas',
    categoria_principal_name: 'Pavas Eléctricas',
  },
  {
    categoria_principal_slug: null,
    categoria_principal_name: 'Tablets',
  },
];

const taxonomy = buildCategoryTaxonomy(rows);

const tablet = resolveCategory(taxonomy, 'tablets', 'Tablets ');
const pavas = resolveCategory(taxonomy, 'pavas-electricas', 'Pavas Electricas');
const nameFallback = resolveCategory(taxonomy, null, 'Tablets');

if (tablet.name !== 'Tablets' || tablet.facet !== 'tablets') {
  throw new Error(`tablet resolution failed: ${JSON.stringify(tablet)}`);
}

if (pavas.name !== 'Pavas Eléctricas' || pavas.facet !== 'pavas-electricas') {
  throw new Error(`pavas resolution failed: ${JSON.stringify(pavas)}`);
}

if (nameFallback?.facet !== 'tablets') {
  throw new Error(`name fallback failed: ${JSON.stringify(nameFallback)}`);
}

if (normalizeCategoryName('Tablets ') !== 'tablets') {
  throw new Error('normalizeCategoryName failed');
}

console.log('[categories] unit checks passed');
