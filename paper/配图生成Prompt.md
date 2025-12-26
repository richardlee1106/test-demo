# 论文配图 AI 生成 Prompt 集合

> 以下 Prompt 适用于 **Midjourney**、**DALL-E 3**、**Stable Diffusion**、**文心一言** 等主流文生图工具。
> 建议选择 **技术图表/扁平化风格**，避免过度艺术化渲染。

---

## 图 1：主流标签云布局算法对比示意图

### 中文 Prompt

```
学术论文技术插图，展示三种标签云布局算法的对比效果。
左侧：顺序排列布局，文字标签水平排列成多行，简单整齐。
中间：螺旋线布局，文字标签沿阿基米德螺旋线从中心向外分布，形成螺旋形状。
右侧：力导向布局，文字标签散布在空间中，模拟物理斥力效果。
每个布局下方标注名称。纯白色背景，扁平化设计风格，适合学术出版物使用。高清晰度，简洁专业。
```

### English Prompt

```
Academic technical illustration showing three tag cloud layout algorithms comparison.
Left: Sequential layout with text labels arranged horizontally in rows.
Center: Spiral layout with text labels distributed along Archimedean spiral from center outward.
Right: Force-directed layout with text labels scattered with physical repulsion simulation.
Labels named below each. Pure white background, flat design style, suitable for academic publication. High resolution, clean and professional.
```

---

## 图 2：动态重心引力算法原理示意图 ⭐ 核心配图

### 中文 Prompt

```
学术技术示意图，展示动态重心引力算法的工作原理。
画布中心有初始重心点C0（蓝色实心圆点）。
第一个大字标签放置在中心位置。
箭头指向新的重心位置C1，重心随标签放置而移动。
第二个标签从新重心C1出发，沿着虚线螺旋路径搜索位置。
多个标签依次放置，重心从C0→C1→C2→C3逐步迁移。
标注"动态重心"和"螺旋搜索路径"。
浅蓝色渐变背景，扁平化技术图表风格，带坐标网格线。高分辨率，学术论文插图。
```

### English Prompt

```
Technical diagram illustrating Dynamic Centroid Gravity Algorithm principle.
Canvas center shows initial centroid C0 (blue filled circle).
First large tag placed at center. Arrow pointing to new centroid C1, centroid moves with tag placement.
Second tag starts from C1, searching position along dashed spiral path.
Multiple tags placed sequentially, centroid migrating C0→C1→C2→C3.
Labels showing "Dynamic Centroid" and "Spiral Search Path".
Light blue gradient background, flat technical diagram style with coordinate grid lines. High resolution, academic paper illustration.
```

---

## 图 3：DCGA 算法流程图

### 中文 Prompt

```
学术论文算法流程图，展示动态重心引力算法(DCGA)的完整流程。
从上到下的流程结构：
开始 → 输入标签数组 → 预处理测量尺寸 → 按大小排序 → 初始化RBush索引树 → 初始化重心
→ 循环：遍历每个标签 → 从重心开始螺旋搜索 → 判断是否碰撞
→ 是：继续搜索 / 否：放置标签、更新索引、更新重心
→ 循环结束 → 输出结果 → 结束
使用标准流程图符号（矩形表示处理、菱形表示判断、圆角矩形表示开始结束）。
浅灰背景，蓝绿配色方案，清晰的流程连接箭头。专业技术图表风格。
```

### English Prompt

```
Academic algorithm flowchart showing Dynamic Centroid Gravity Algorithm (DCGA) complete process.
Top-to-bottom flow structure:
Start → Input tag array → Preprocess measure dimensions → Sort by size → Initialize RBush index tree → Initialize centroid
→ Loop: Iterate each tag → Spiral search from centroid → Check collision?
→ Yes: Continue search / No: Place tag, Update index, Update centroid
→ Loop end → Output results → End
Using standard flowchart symbols (rectangles for process, diamonds for decision, rounded rectangles for start/end).
Light gray background, blue-green color scheme, clear flow connection arrows. Professional technical diagram style.
```

---

## 图 4：径向螺旋搜索示意图

### 中文 Prompt

```
技术示意图，展示阿基米德螺旋线径向搜索过程。
以中心重心点为原点，一条蓝色虚线阿基米德螺旋线向外延伸。
螺旋线上有多个搜索点（小圆点），标注搜索方向箭头。
在某些搜索点上显示红色矩形表示"碰撞检测失败"。
在一个点上显示绿色矩形表示"找到有效位置"。
标注数学公式 r = step × θ。
标注螺旋参数：步长(step)、角度(θ)、半径(r)。
纯白背景，极简技术风格，适合学术论文。高对比度，清晰可读。
```

### English Prompt

```
Technical diagram showing Archimedean spiral radial search process.
Center point as origin, blue dashed Archimedean spiral line extending outward.
Multiple search points (small dots) on spiral with direction arrows.
Some search points showing red rectangles indicating "collision detected".
One point showing green rectangle indicating "valid position found".
Mathematical formula labeled: r = step × θ.
Spiral parameters labeled: step, angle(θ), radius(r).
Pure white background, minimalist technical style, suitable for academic papers. High contrast, clear and readable.
```

---

## 图 5：RBush 空间索引结构示意图

### 中文 Prompt

```
技术数据结构示意图，展示RBush R-tree空间索引结构。
上半部分：树形结构图，根节点在顶部，多层分支向下延伸，叶节点包含矩形数据。
下半部分：二维平面空间视图，显示多个嵌套的最小边界矩形(MBR)，
大矩形包含小矩形，形成层级分割结构。
用不同颜色区分不同层级（蓝色、绿色、橙色）。
标注"根节点"、"中间节点"、"叶节点"、"MBR边界"。
浅蓝背景，扁平化技术风格，科技感配色。学术论文插图质量。
```

### English Prompt

```
Technical data structure diagram showing RBush R-tree spatial index structure.
Upper part: Tree structure with root node at top, multi-level branches extending downward, leaf nodes containing rectangle data.
Lower part: 2D plane space view, showing multiple nested Minimum Bounding Rectangles (MBR), large rectangles containing smaller ones, forming hierarchical partition structure.
Different colors distinguishing different levels (blue, green, orange).
Labels: "Root Node", "Intermediate Node", "Leaf Node", "MBR Boundary".
Light blue background, flat technical style, tech-inspired color scheme. Academic paper illustration quality.
```

---

## 图 6：两种算法布局效果对比

### 中文 Prompt

```
学术对比示意图，左右两栏布局，对比两种标签云算法效果。
左侧标题"动态重心引力算法(Basic)"：
- 标签云呈紧凑圆形分布
- 中心区域标签密集
- 外围标签稀疏
- 整体形状接近圆形

右侧标题"阿基米德螺旋算法(Spiral)"：
- 标签云呈螺旋分布
- 可见螺旋线轨迹
- 从中心向外逐渐稀疏
- 整体形状较分散

标签用不同大小的矩形或实际中文词语表示（如"餐饮"、"旅游"、"购物"等）。
白色背景，淡蓝色边框区分左右，专业学术风格。
```

### English Prompt

```
Academic comparison illustration, two-column layout comparing two tag cloud algorithm effects.
Left column titled "Dynamic Centroid Gravity Algorithm (Basic)":
- Tag cloud in compact circular distribution
- Dense tags in center area
- Sparse tags on periphery
- Overall shape approaching circle

Right column titled "Archimedean Spiral Algorithm (Spiral)":
- Tag cloud in spiral distribution
- Visible spiral trajectory
- Gradually sparse from center outward
- Overall shape more dispersed

Tags represented by different sized rectangles or actual words (like "Dining", "Tourism", "Shopping").
White background, light blue borders separating columns, professional academic style.
```

---

## 图 7：系统架构图

### 中文 Prompt

```
软件系统架构图，四层分层架构设计，自上而下排列。

第一层"用户界面层"：包含三个组件框
- ControlPanel控制面板
- MapContainer地图容器
- TagCloud标签云容器

第二层"业务逻辑层"：包含两个模块
- OpenLayers地图引擎
- D3.js可视化引擎

第三层"布局计算层"：包含三个Web Worker
- basic.worker动态重心算法
- spiral.worker螺旋算法
- geo.worker地理感知算法

第四层"数据层"：
- GeoJSON POI数据
- 栅格权重数据

各层之间有箭头表示数据流向。
采用蓝紫渐变配色，现代扁平化UI风格，白色背景。适合技术文档。
```

### English Prompt

```
Software system architecture diagram, four-layer hierarchical design, arranged top to bottom.

Layer 1 "User Interface Layer": Three component boxes
- ControlPanel
- MapContainer
- TagCloud Container

Layer 2 "Business Logic Layer": Two modules
- OpenLayers Map Engine
- D3.js Visualization Engine

Layer 3 "Layout Computation Layer": Three Web Workers
- basic.worker Dynamic Centroid Algorithm
- spiral.worker Spiral Algorithm
- geo.worker Geo-aware Algorithm

Layer 4 "Data Layer":
- GeoJSON POI Data
- Raster Weight Data

Arrows between layers showing data flow.
Blue-purple gradient color scheme, modern flat UI style, white background. Suitable for technical documentation.
```

---

## 图 8：地理感知标签云效果图

### 中文 Prompt

```
技术示意图，展示地理感知标签云的方位保持特性。
中央有一个圆形区域表示"中心位置"。
标签按地理方位分布在四个象限：
- 右上象限（东北方向）：标签A、B、C
- 左上象限（西北方向）：标签D、E
- 左下象限（西南方向）：标签F、G、H
- 右下象限（东南方向）：标签I、J

四个象限用淡色填充区分，标注"东北"、"西北"、"西南"、"东南"。
虚线十字线穿过中心，分隔四个象限。
标签距离中心的远近反映地理距离。
浅色背景，技术图表风格，清晰的象限分区。
```

### English Prompt

```
Technical diagram showing geo-aware tag cloud's direction-preserving feature.
Center has a circular area representing "Center Location".
Tags distributed in four quadrants by geographic direction:
- Upper-right quadrant (Northeast): Tags A, B, C
- Upper-left quadrant (Northwest): Tags D, E
- Lower-left quadrant (Southwest): Tags F, G, H
- Lower-right quadrant (Southeast): Tags I, J

Four quadrants distinguished by light color fills, labeled "NE", "NW", "SW", "SE".
Dashed crosshair through center separating quadrants.
Tag distance from center reflects geographic distance.
Light background, technical diagram style, clear quadrant divisions.
```

---

## 图 9：布局耗时对比柱状图

### 中文 Prompt

```
学术数据可视化柱状图，展示布局耗时对比。
X轴：标签数量（50, 100, 200, 500, 1000）
Y轴：布局耗时（毫秒ms）

每个X轴位置有两根柱子：
- 蓝色柱子表示"Basic算法"
- 紫色柱子表示"Spiral算法"

数据趋势：随着标签数量增加，两种算法耗时都增加，但Spiral增长更快。
在1000标签时，Spiral柱子明显高于Basic。

带图例说明，有网格线辅助阅读。
白色背景，专业统计图表风格，高清晰度。
```

### English Prompt

```
Academic data visualization bar chart showing layout time comparison.
X-axis: Tag count (50, 100, 200, 500, 1000)
Y-axis: Layout time (milliseconds ms)

Two bars at each X-axis position:
- Blue bars for "Basic Algorithm"
- Purple bars for "Spiral Algorithm"

Data trend: Both algorithms increase time with more tags, but Spiral grows faster.
At 1000 tags, Spiral bar clearly taller than Basic.

With legend, grid lines for reading assistance.
White background, professional statistical chart style, high resolution.
```

---

## 图 10：紧凑度对比折线图

### 中文 Prompt

```
学术数据可视化折线图，展示布局紧凑度对比。
X轴：标签数量（50, 100, 200, 500, 1000）
Y轴：紧凑度百分比（40%-60%范围）

两条折线：
- 蓝色实线带圆点标记：Basic算法，趋势上升
- 紫色虚线带方形标记：Spiral算法，趋势相对平缓

Basic线始终高于Spiral线，展示Basic算法的紧凑度优势。
两线之间用淡色填充突出差距区域。

带图例、网格线、数据点标签。
白色背景，学术统计图表风格，清晰专业。
```

### English Prompt

```
Academic data visualization line chart showing layout compactness comparison.
X-axis: Tag count (50, 100, 200, 500, 1000)
Y-axis: Compactness percentage (40%-60% range)

Two lines:
- Blue solid line with circle markers: Basic algorithm, upward trend
- Purple dashed line with square markers: Spiral algorithm, relatively flat trend

Basic line consistently above Spiral line, showing Basic algorithm compactness advantage.
Light fill between two lines highlighting difference area.

With legend, grid lines, data point labels.
White background, academic statistical chart style, clear and professional.
```

---

## 🎨 通用生成技巧

### 风格关键词建议

```
学术风格: academic, scientific, technical illustration, publication quality
扁平化: flat design, minimalist, clean, modern
高清晰度: high resolution, 4K, crisp, sharp details
技术图表: diagram, schematic, flowchart, infographic
配色建议: blue color scheme, professional colors, muted tones
```

### 负面提示词（Negative Prompt）

```
不要: 3D渲染, 过度艺术化, 照片质感, 复杂阴影, 纹理过多
Avoid: 3D rendering, artistic style, photorealistic, complex shadows, excessive textures
```

### 推荐生成参数（以 Midjourney 为例）

```
--ar 16:9    # 宽屏比例，适合论文插图
--q 2        # 高质量
--style raw  # 减少艺术风格化
--v 6        # 使用最新版本
```

---

## 📋 快速使用检查表

| 图号  | 描述         | 推荐比例 | 优先级          |
| ----- | ------------ | -------- | --------------- |
| 图 2  | 动态重心原理 | 4:3      | ⭐⭐⭐ 核心     |
| 图 3  | 算法流程图   | 3:4      | ⭐⭐⭐ 核心     |
| 图 6  | 效果对比     | 16:9     | ⭐⭐ 重要       |
| 图 7  | 系统架构     | 4:3      | ⭐⭐ 重要       |
| 图 4  | 螺旋搜索     | 1:1      | ⭐ 辅助         |
| 图 5  | RBush 结构   | 4:3      | ⭐ 辅助         |
| 图 8  | 地理感知     | 1:1      | ⭐ 辅助         |
| 图 9  | 柱状图       | 4:3      | ⭐ 可用代码生成 |
| 图 10 | 折线图       | 4:3      | ⭐ 可用代码生成 |
| 图 1  | 算法对比     | 16:9     | 可选            |

> 💡 **提示**：图 9 和图 10（柱状图、折线图）建议使用 **Python matplotlib** 或 **Excel** 生成，数据更准确。
