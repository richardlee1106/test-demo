# 多选区对比分析功能 - 实施计划

## 需求概述

1. **前端**：支持最多 6 个选区绘制（圆形 + 多边形混合），选区可重叠，每个选区中心显示标签（选区1、选区2...）
2. **后端**：支持跨选区对比分析，如"分析选区1和选区4的产业结构差异"

---

## 数据结构设计

### 选区数据结构 (Region)

```typescript
interface Region {
  id: number;           // 选区编号 1-6
  name: string;         // "选区1", "选区2"...
  type: 'Polygon' | 'Circle';
  geometry: GeoJSON.Geometry;  // WGS84 坐标系
  center: [number, number];    // 中心点 [lon, lat]
  boundaryWKT: string;         // PostGIS 查询用
  pois: GeoJSON.Feature[];     // 选区内的 POI 缓存
  createdAt: Date;
}
```

### 前端状态管理

```javascript
// MapContainer.vue 或 App.vue
const regions = ref<Region[]>([])  // 最多 6 个
const activeRegionId = ref<number | null>(null)  // 当前激活的选区
```

---

## 实施步骤

### 阶段 1: 前端多选区管理

#### 1.1 修改 MapContainer.vue

- [x] 将 `currentGeometry` 改为 `regions` 数组
- [x] 增加选区数量限制 (MAX_REGIONS = 6)
- [x] 每个选区使用不同颜色区分
- [x] 在选区中心添加 Text 标签

#### 1.2 修改 ControlPanel.vue

- [x] 显示当前选区数量 (1/6, 2/6...)
- [x] 添加"清空所有选区"按钮
- [x] 添加"删除指定选区"功能

#### 1.3 修改 App.vue

- [x] 管理 regions 状态
- [x] 提供 regions 数据给 AI 对话

### 阶段 2: Planner 识别选区引用

#### 2.1 新增 QueryPlan 字段

```json
{
  "query_type": "region_comparison",
  "target_regions": [1, 4],  // 用户提到的选区编号
  "comparison_dimensions": ["产业结构", "商业分布"]
}
```

#### 2.2 修改 ROUTER_PROMPT

增加选区识别能力

#### 2.3 修改 PLANNER_SYSTEM_PROMPT

增加多选区对比场景的处理逻辑

### 阶段 3: Executor 多选区数据检索

#### 3.1 新增 executeRegionComparison 函数

- 根据选区编号获取边界几何
- 分别查询各选区内的 POI
- 计算各选区的统计信息

#### 3.2 统计信息结构

```json
{
  "region_1": {
    "poi_count": 234,
    "category_distribution": {...},
    "top_categories": [...],
    "landmarks": [...]
  },
  "region_4": {...}
}
```

### 阶段 4: Writer 对比分析生成

#### 4.1 新增对比分析 Prompt 模板

- 结构化输出：选区A vs 选区B
- 图表数据支持（柱状图、饼图）
- 结论与建议

---

## 颜色方案

| 选区 | 填充色 | 描边色 | 标签色 |
|------|--------|--------|--------|
| 选区1 | rgba(52,152,219,0.2) | #3498db | #2980b9 |
| 选区2 | rgba(231,76,60,0.2) | #e74c3c | #c0392b |
| 选区3 | rgba(46,204,113,0.2) | #2ecc71 | #27ae60 |
| 选区4 | rgba(155,89,182,0.2) | #9b59b6 | #8e44ad |
| 选区5 | rgba(241,196,15,0.2) | #f1c40f | #f39c12 |
| 选区6 | rgba(230,126,34,0.2) | #e67e22 | #d35400 |

---

## API 变更

### 前端 -> 后端

POST /api/ai/chat

```json
{
  "question": "分析选区1和选区4的产业结构差异",
  "context": {
    "regions": [
      { "id": 1, "boundaryWKT": "POLYGON(...)", "poiCount": 234 },
      { "id": 4, "boundaryWKT": "POLYGON(...)", "poiCount": 567 }
    ],
    "currentRegionPois": {}  // 可选，前端已加载的 POI
  }
}
```

### 后端响应

```json
{
  "answer": "...",
  "regionAnalysis": {
    "region_1": { ... },
    "region_4": { ... }
  },
  "comparisonResult": {
    "similarities": [...],
    "differences": [...],
    "recommendations": [...]
  }
}
```
