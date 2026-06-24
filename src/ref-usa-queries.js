/**
 * Búsquedas donde conviven SKU normales y ref-/usa- en el índice.
 * El #1 no puede ser es_ref_usa=1 si hay al menos un hit con es_ref_usa=0,
 * y todos los ref/usa deben ir después de los normales en el ranking.
 */
export const REF_USA_QUERIES = [
  { q: 'patineta', note: 'REF-SCOOTER5 vs HOVER*' },
  { q: 'hoverboard', note: 'USA-HOVER* vs hoverboards principales' },
  { q: 'scooter electrico', note: 'variantes ref/usa en scooters' },
  { q: 'parlante gadnic', note: 'outlets ref/usa en audio' },
  { q: 'freidora de aire', note: 'ref/usa en cocina' },
  { q: 'aspiradora robot', note: 'ref/usa en electro' },
  { q: 'silla gamer', note: 'ref/usa en muebles' },
  { q: 'drone', note: 'ref/usa en drones' },
];
