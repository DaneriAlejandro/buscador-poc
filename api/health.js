import { getHealthInfo } from '../src/web/search.js';

export default async function handler(_req, res) {
  try {
    return res.status(200).json(getHealthInfo());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
