import { searchProducts } from '../src/web/search.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await searchProducts({
      q: req.query.q,
      limit: req.query.limit,
      offset: req.query.offset,
      scores: req.query.scores,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[api/search]', error.message);
    return res.status(500).json({ error: error.message });
  }
}
