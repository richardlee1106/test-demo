import db from '../services/database.js';

/**
 * 从数据库动态生成分类树
 * @returns {Promise<Array>}
 */
export async function getCategoryTreeFromDB() {
  const sql = `
    SELECT DISTINCT 
      COALESCE(category_big, '未分类') as big,
      COALESCE(category_mid, '未分类') as mid,
      COALESCE(category_small, '未分类') as small
    FROM pois
    ORDER BY big, mid, small
  `;
  
  try {
    const result = await db.query(sql);
    const rows = result.rows;
    
    const tree = [];
    const map = {};
    
    rows.forEach(row => {
      const { big, mid, small } = row;
      
      if (!map[big]) {
        map[big] = { value: big, label: big, children: [] };
        tree.push(map[big]);
      }
      
      let midNode = map[big].children.find(c => c.value === mid);
      if (!midNode) {
        midNode = { value: mid, label: mid, children: [] };
        map[big].children.push(midNode);
      }
      
      let smallNode = midNode.children.find(c => c.value === small);
      if (!smallNode) {
        smallNode = { value: small, label: small };
        midNode.children.push(smallNode);
      }
    });
    
    return tree;
  } catch (err) {
    console.error('Failed to generate category tree from DB:', err);
    throw err;
  }
}
