const form = document.getElementById('search-form');
const input = document.getElementById('query');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');
const showScoresEl = document.getElementById('show-scores');
const categoriesSection = document.getElementById('categories');
const categoryListEl = document.getElementById('category-list');
const loadMoreStatusEl = document.getElementById('load-more-status');
const tabs = document.querySelectorAll('.tab');

const PAGE_SIZE = 20;

let debounceTimer;
let scope = 'bidcom';
let selectedCategory = null;
let activeSearchId = 0;
let loadMoreObserver;

const pagination = {
  query: '',
  offset: 0,
  total: 0,
  loading: false,
  hasMore: false,
};

function setScope(nextScope) {
  scope = nextScope;
  selectedCategory = null;
  for (const tab of tabs) {
    const active = tab.dataset.scope === scope;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    setScope(tab.dataset.scope);
    search(input.value.trim());
  });
}

function formatPrice(value) {
  if (value == null || value === '') {
    return null;
  }
  const number = Number(String(value).replace(/[^\d.,]/g, '').replace(',', '.'));
  if (!Number.isFinite(number)) {
    return String(value);
  }
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(number);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHit(hit, index) {
  const price = formatPrice(hit.precio);
  const oldPrice = formatPrice(hit.precio_tachado);
  const score =
    hit._rankingScore != null
      ? `<span class="badge badge-score">score ${Number(hit._rankingScore).toFixed(4)}</span>`
      : '';

  const badges = [
    hit.marca ? `<span class="badge">${escapeHtml(hit.marca)}</span>` : '',
    hit.categoria_principal_name
      ? `<span class="badge badge-muted">${escapeHtml(hit.categoria_principal_name)}</span>`
      : '',
    hit.orden_web != null ? `<span class="badge badge-muted">ow ${hit.orden_web}</span>` : '',
    hit.es_ref_usa === 1 ? `<span class="badge badge-muted">ref/usa</span>` : '',
    hit.es_accesorio === 1 ? `<span class="badge badge-warn">accesorio</span>` : '',
    score,
  ]
    .filter(Boolean)
    .join('');

  const image = hit.imagen_calada
    ? `<img class="thumb" src="${escapeHtml(hit.imagen_calada)}" alt="" loading="lazy" />`
    : `<div class="thumb thumb-empty">Sin foto</div>`;

  const priceBlock =
    price != null
      ? `<div class="price">${oldPrice ? `<s>${escapeHtml(oldPrice)}</s> ` : ''}${escapeHtml(price)}${
          hit.descuento ? ` <span class="discount">-${escapeHtml(hit.descuento)}%</span>` : ''
        }</div>`
      : '';

  return `
    <li class="card">
      ${image}
      <div class="card-body">
        <div class="card-rank">#${index + 1}</div>
        <h2 class="title">${escapeHtml(hit.post_title)}</h2>
        <div class="badges">${badges}</div>
        ${priceBlock}
        <dl class="meta-grid">
          ${hit.codigo_aguila ? `<div><dt>SKU</dt><dd>${escapeHtml(hit.codigo_aguila)}</dd></div>` : ''}
          ${hit.ean ? `<div><dt>EAN</dt><dd>${escapeHtml(hit.ean)}</dd></div>` : ''}
          ${hit.ID ? `<div><dt>ID</dt><dd>${escapeHtml(hit.ID)}</dd></div>` : ''}
        </dl>
      </div>
    </li>
  `;
}

let categoryOptions = [];

function renderCategories(categorias) {
  categoryListEl.innerHTML = '';
  categoryOptions = categorias?.buckets ?? [];

  if (!categoryOptions.length) {
    categoriesSection.hidden = true;
    return;
  }

  categoriesSection.hidden = false;

  for (const { slug, key, doc_count: count } of categoryOptions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `category-chip${selectedCategory === slug ? ' active' : ''}`;
    button.innerHTML = `${escapeHtml(key)} <span class="category-count">${count}</span>`;
    button.addEventListener('click', () => {
      selectedCategory = selectedCategory === slug ? null : slug;
      search(input.value.trim());
    });
    categoryListEl.appendChild(button);
  }
}

function getSelectedCategoryLabel() {
  return categoryOptions.find((category) => category.slug === selectedCategory)?.key ?? selectedCategory;
}

function updateMeta(shown, total, processingTimeMs) {
  const parts = [`${total.toLocaleString('es-AR')} resultados`];
  if (shown > 0 && shown < total) {
    parts.push(`mostrando ${shown.toLocaleString('es-AR')}`);
  }
  if (processingTimeMs != null) {
    parts.push(`${processingTimeMs} ms`);
  }
  metaEl.textContent = parts.join(' · ');
}

function setLoadMoreStatus(message) {
  if (message) {
    loadMoreStatusEl.hidden = false;
    loadMoreStatusEl.textContent = message;
  } else {
    loadMoreStatusEl.hidden = true;
    loadMoreStatusEl.textContent = '';
  }
}

function updatePagination(query, offset, total) {
  pagination.query = query;
  pagination.offset = offset;
  pagination.total = total;
  pagination.hasMore = offset < total;
}

function setupLoadMoreObserver(searchId) {
  loadMoreObserver?.disconnect();

  if (!pagination.hasMore) {
    setLoadMoreStatus('');
    return;
  }

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (
        entries[0]?.isIntersecting &&
        searchId === activeSearchId &&
        pagination.hasMore &&
        !pagination.loading
      ) {
        loadMore(searchId);
      }
    },
    { rootMargin: '240px' },
  );

  loadMoreObserver.observe(loadMoreStatusEl);
}

function buildSearchParams(query, offset) {
  const params = new URLSearchParams({
    q: query,
    limit: String(PAGE_SIZE),
    offset: String(offset),
    scope,
  });

  if (selectedCategory) {
    params.set('category', selectedCategory);
  }
  if (showScoresEl.checked) {
    params.set('scores', '1');
  }

  return params;
}

async function fetchPage(query, offset, { append, searchId }) {
  pagination.loading = true;

  if (append) {
    setLoadMoreStatus('Cargando más resultados…');
  } else {
    setLoadMoreStatus('');
    statusEl.textContent = 'Buscando…';
    resultsEl.innerHTML = '';
  }

  try {
    const response = await fetch(`/api/search?${buildSearchParams(query, offset)}`);
    const data = await response.json();

    if (searchId !== activeSearchId) {
      return null;
    }

    if (!response.ok) {
      categoriesSection.hidden = true;
      statusEl.textContent = `Error: ${data.error ?? response.statusText}`;
      setLoadMoreStatus('');
      return null;
    }

    const total = data.estimatedTotalHits ?? data.hits.length;
    const nextOffset = offset + data.hits.length;
    updatePagination(query, nextOffset, total);
    updateMeta(nextOffset, total, data.processingTimeMs);

    if (!query) {
      categoriesSection.hidden = true;
      statusEl.textContent = 'Escribí algo para buscar.';
      setLoadMoreStatus('');
      return null;
    }

    if (!append) {
      renderCategories(data.categorias);
    }

    if (data.hits.length === 0 && !append) {
      statusEl.textContent = selectedCategory
        ? 'Sin productos en esa categoría.'
        : 'Sin resultados.';
      setLoadMoreStatus('');
      return null;
    }

    const html = data.hits.map((hit, index) => renderHit(hit, offset + index)).join('');

    if (append) {
      resultsEl.insertAdjacentHTML('beforeend', html);
    } else {
      statusEl.textContent = selectedCategory
        ? `Filtrando: ${getSelectedCategoryLabel()}`
        : '';
      resultsEl.innerHTML = html;
    }

    if (pagination.hasMore) {
      setLoadMoreStatus('Deslizá para cargar más');
    } else if (nextOffset > 0) {
      setLoadMoreStatus('Fin de los resultados');
    } else {
      setLoadMoreStatus('');
    }

    setupLoadMoreObserver(searchId);
    return data;
  } finally {
    if (searchId === activeSearchId) {
      pagination.loading = false;
    }
  }
}

async function search(query) {
  activeSearchId += 1;
  const searchId = activeSearchId;
  loadMoreObserver?.disconnect();
  updatePagination(query, 0, 0);

  if (!query) {
    resultsEl.innerHTML = '';
    categoriesSection.hidden = true;
    metaEl.textContent = '';
    statusEl.textContent = 'Escribí algo para buscar.';
    setLoadMoreStatus('');
    return;
  }

  await fetchPage(query, 0, { append: false, searchId });
}

async function loadMore(searchId) {
  if (
    searchId !== activeSearchId ||
    pagination.loading ||
    !pagination.hasMore ||
    !pagination.query
  ) {
    return;
  }

  await fetchPage(pagination.query, pagination.offset, { append: true, searchId });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  search(input.value.trim());
});

input.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (input.value.trim().length >= 2 || input.value.trim() === '') {
      selectedCategory = null;
      search(input.value.trim());
    }
  }, 300);
});

showScoresEl.addEventListener('change', () => {
  if (input.value.trim()) {
    search(input.value.trim());
  }
});

search('');
