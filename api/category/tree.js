import { initDatabase } from '../../fastify-backend/services/database.js';
import { getCategoryTreeFromDB } from '../../fastify-backend/services/catalog.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 确保数据库已初始化
    await initDatabase();
    
    const tree = await getCategoryTreeFromDB();
    res.status(200).json(tree);
  } catch (err) {
    console.error('Vercel API Error:', err);
    res.status(500).json({ error: 'Failed to load categories', details: err.message });
  }
}
