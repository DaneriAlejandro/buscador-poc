const form = document.getElementById('search-form');
const input = document.getElementById('query');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');
const showScoresEl = document.getElementById('show-scores');

let debounceTimer;

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

async function search(query) {
  const params = new URLSearchParams({ q: query, limit: '20' });
  if (showScoresEl.checked) {
    params.set('scores', '1');
  }

  statusEl.textContent = 'Buscando…';
  resultsEl.innerHTML = '';

  const response = await fetch(`/api/search?${params}`);
  const data = await response.json();

  if (!response.ok) {
    statusEl.textContent = `Error: ${data.error ?? response.statusText}`;
    return;
  }

  const total = data.estimatedTotalHits ?? data.hits.length;
  metaEl.textContent = `${total.toLocaleString('es-AR')} resultados · ${data.processingTimeMs} ms`;

  if (!query) {
    statusEl.textContent = 'Escribí algo para buscar.';
    return;
  }

  if (data.hits.length === 0) {
    statusEl.textContent = 'Sin resultados.';
    return;
  }

  statusEl.textContent = '';
  resultsEl.innerHTML = data.hits.map(renderHit).join('');
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  search(input.value.trim());
});

input.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (input.value.trim().length >= 2 || input.value.trim() === '') {
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
