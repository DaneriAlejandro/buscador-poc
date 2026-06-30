import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function normalizeCategoryName(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function trimValue(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function rankDisplayName(name, count) {
  return [
    count,
    name === name.trim() ? 1 : 0,
    /[áéíóúñ]/i.test(name) ? 1 : 0,
    name.length,
  ];
}

function isBetterDisplayName(candidate, current) {
  const left = rankDisplayName(candidate.name, candidate.count);
  const right = rankDisplayName(current.name, current.count);

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] > right[index];
    }
  }

  return false;
}

function pickCanonicalNameForSlug(nameCounts) {
  const groups = new Map();

  for (const [rawName, count] of nameCounts) {
    const trimmed = trimValue(rawName);
    if (!trimmed) {
      continue;
    }

    const key = normalizeCategoryName(trimmed);
    const group = groups.get(key) ?? { total: 0, names: new Map() };
    group.total += count;
    group.names.set(trimmed, (group.names.get(trimmed) || 0) + count);
    groups.set(key, group);
  }

  let bestGroup = null;
  for (const group of groups.values()) {
    if (!bestGroup || group.total > bestGroup.total) {
      bestGroup = group;
    }
  }

  if (!bestGroup) {
    return '';
  }

  let best = null;
  for (const [name, count] of bestGroup.names) {
    const candidate = { name, count };
    if (!best || isBetterDisplayName(candidate, best)) {
      best = candidate;
    }
  }

  return best?.name ?? '';
}

export function buildCategoryTaxonomy(rows) {
  const slugNameCounts = new Map();
  const normalizedNameSlugs = new Map();

  for (const row of rows) {
    const slug = trimValue(row.categoria_principal_slug);
    const name = trimValue(row.categoria_principal_name);

    if (slug && name) {
      const counts = slugNameCounts.get(slug) ?? new Map();
      counts.set(name, (counts.get(name) || 0) + 1);
      slugNameCounts.set(slug, counts);
    }

    if (name && slug) {
      const key = normalizeCategoryName(name);
      const slugs = normalizedNameSlugs.get(key) ?? new Set();
      slugs.add(slug);
      normalizedNameSlugs.set(key, slugs);
    }
  }

  const bySlug = new Map();
  for (const [slug, nameCounts] of slugNameCounts) {
    const canonicalName = pickCanonicalNameForSlug(nameCounts);
    bySlug.set(slug, {
      facet: slug,
      slug,
      name: canonicalName || slug,
    });
  }

  const byNormalizedName = new Map();
  for (const [normalizedName, slugs] of normalizedNameSlugs) {
    if (slugs.size === 1) {
      byNormalizedName.set(normalizedName, [...slugs][0]);
    }
  }

  return { bySlug, byNormalizedName };
}

export function resolveCategory(taxonomy, rawSlug, rawName) {
  const slug = trimValue(rawSlug);
  const name = trimValue(rawName);

  if (slug && taxonomy.bySlug.has(slug)) {
    return taxonomy.bySlug.get(slug);
  }

  if (name) {
    const normalizedName = normalizeCategoryName(name);
    const fallbackSlug = taxonomy.byNormalizedName.get(normalizedName);
    if (fallbackSlug && taxonomy.bySlug.has(fallbackSlug)) {
      return taxonomy.bySlug.get(fallbackSlug);
    }
  }

  if (slug) {
    return {
      facet: slug,
      slug,
      name: name || slug,
    };
  }

  if (name) {
    return null;
  }

  return null;
}

export function applyCategoryFields(document, taxonomy) {
  const resolved = resolveCategory(
    taxonomy,
    document.categoria_principal_slug,
    document.categoria_principal_name,
  );

  if (!resolved?.facet) {
    document.categoria_facet = null;
    return false;
  }

  document.categoria_facet = resolved.facet;
  document.categoria_principal_slug = resolved.slug;
  document.categoria_principal_name = resolved.name;
  return true;
}

export function getCategoryLabels(taxonomy) {
  const labels = {};

  for (const [slug, entry] of taxonomy.bySlug) {
    labels[slug] = entry.name;
  }

  return labels;
}

export async function saveCategoryLabels(labels, publicDir) {
  const filePath = join(publicDir, 'categories.json');
  await writeFile(filePath, `${JSON.stringify(labels, null, 2)}\n`, 'utf8');
  return filePath;
}
