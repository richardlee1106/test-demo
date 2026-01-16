export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  
  res.status(200).json({
    success: true,
    results: [],
    message: "语义搜索功能正在迁移至分布式架构。"
  });
}
