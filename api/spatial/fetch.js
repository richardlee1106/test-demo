import db, { initDatabase } from '../../fastify-backend/services/database.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { categories, limit = 1000, bounds } = req.body;
  if (!categories || !Array.isArray(categories)) {
    return res.status(400).json({ error: 'Missing categories array' });
  }

  try {
    // 确保数据库已初始化
    await initDatabase();

    let geometry = null;
    if (bounds) {
      const [w, s, e, n] = bounds;
      geometry = `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
    }

    const results = await db.findPOIsFiltered({
      categories,
      geometry,
      limit
    });

    const features = results.map(p => ({
      type: 'Feature',
      id: p.id || p.poiid,
      geometry: {
        type: 'Point',
        coordinates: [parseFloat(p.lon), parseFloat(p.lat)]
      },
      properties: {
        name: p.name,
        address: p.address,
        type: p.type,
        category_mid: p.category_mid,
        category_small: p.category_small,
      }
    }));

    res.status(200).json({
      success: true,
      count: results.length,
      features
    });
  } catch (error) {
    console.error('Vercel API Error:', error);
    res.status(500).json({ error: 'Fetch failed', details: error.message });
  }
}
