import * as d3 from 'd3-force';

// 如果需要，为 OffscreenCanvas 添加 Polyfill（现在 worker 中通常已有，但为了安全起见）
if (typeof self.document === 'undefined') {
    self.document = {
        createElement: (tagName) => {
            if (tagName === 'canvas') {
                return new OffscreenCanvas(1, 1);
            }
            return {};
        }
    };
}

self.onmessage = event => {
    const { tags, width, height, center, bounds, config } = event.data;
    runGeoLayout(tags, width, height, center, bounds, config);
};

/**
 * 运行地理空间布局算法
 * 核心逻辑：
 * 1. 投影：将经纬度映射到屏幕坐标，保持地理相对位置。
 * 2. 碰撞检测：使用自定义矩形碰撞算法，解决标签重叠。
 * 3. 优化：多阶段模拟（动态+静态清理），确保密集区域也能尽量展开。
 * 
 * @param {Array} tags - 标签数据数组
 * @param {number} width - 画布宽度
 * @param {number} height - 画布高度
 * @param {Array} center - [lon, lat] 指定的中心点（可选）
 * @param {Array} bounds - 地图边界（可选）
 * @param {Object} config - 配置项
 */
function runGeoLayout(tags, width, height, center, bounds, config) {
    if (!tags || tags.length === 0) {
        self.postMessage([]);
        return;
    }

    console.log('[GeoWorker] 开始运行地理布局', { width, height, center, bounds });

    // 1. 设置 Canvas 用于文本测量
    // 使用 OffscreenCanvas 在 Worker 线程中测量文本宽高
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const fontMin = config?.fontMin || 18;
    const fontMax = config?.fontMax || 22;

    // 2. 注入中心标签 (Center Tag)
    // 用户希望在视觉中心显示“中心位置”文本
    // 我们将其视为一个特殊的固定标签，位于 (width/2, height/2)
    const centerTag = {
        name: '中心位置',
        isCenter: true,
        x: width / 2,
        y: height / 2,
        fx: width / 2, // D3 中固定位置
        fy: height / 2,
        fontSize: fontMax + 4, // 稍微大一点
        weight: 100, // 最粗
        originalIndex: -1, // 特殊索引
        // 中心标签大概尺寸
        width: 80, 
        height: 30
    };
    ctx.font = `900 ${centerTag.fontSize}px sans-serif`;
    centerTag.width = Math.ceil(ctx.measureText(centerTag.name).width);
    centerTag.height = Math.ceil(centerTag.fontSize * 1.2);
    
    // 3. 预处理标签 (测量尺寸 & 计算地理目标位置)
    // 我们需要将 (lon, lat) 映射到 (x, y)
    // 使用基于过滤后 POI 边界的简单线性投影
    // 为了保持相对方向，我们基于最大维度偏差进行缩放
    
    // 确定中心点和缩放比例
    // 如果提供了 center (圆形模式)，使用它。
    let centerLon, centerLat;
    if (center && Array.isArray(center) && center.length === 2) {
        [centerLon, centerLat] = center;
    } else {
        // 如果未提供中心点，则计算标签的质心
        let sumLon = 0, sumLat = 0, count = 0;
        tags.forEach(t => {
            if (t.lon !== undefined && t.lat !== undefined) {
                sumLon += t.lon;
                sumLat += t.lat;
                count++;
            }
        });
        if (count > 0) {
            centerLon = sumLon / count;
            centerLat = sumLat / count;
        } else {
            centerLon = 0; centerLat = 0;
        }
    }

    const padding = 60; // 标签边缘的额外内边距
    const availWidth = width - padding * 2;
    const availHeight = height - padding * 2;
    
    // 计算最大增量以确定缩放比例
    let maxDx = 0;
    let maxDy = 0;
    
    // 经度校正因子 (近似米制比例)
    // 我们希望保持角度，所以需要考虑经度度数比纬度度数短的问题
    // factorX = cos(纬度)，用于收缩经度差值
    const latRad = centerLat * Math.PI / 180;
    const factorX = Math.cos(latRad); 
    const factorY = 1;

    tags.forEach(t => {
        if (t.lon !== undefined && t.lat !== undefined) {
            const dx = Math.abs((t.lon - centerLon) * factorX);
            const dy = Math.abs((t.lat - centerLat) * factorY);
            if (dx > maxDx) maxDx = dx;
            if (dy > maxDy) maxDy = dy;
        }
    });
    
    // 避免除以零
    if (maxDx === 0) maxDx = 0.001;
    if (maxDy === 0) maxDy = 0.001;
    
    // 统一缩放比例 (Uniform Scale)
    // 取宽和高缩放的较小值，确保地图不会变形
    const scale = Math.min(availWidth / 2 / maxDx, availHeight / 2 / maxDy);

    const processedTags = tags.map((tag, i) => {
        // 尺寸计算
        const normalizedIndex = i / Math.max(1, tags.length - 1);
        const sizeRatio = 1 - Math.pow(normalizedIndex, 0.5); // 排名靠前的标签更大
        const fontSize = fontMin + sizeRatio * (fontMax - fontMin);

        ctx.font = `${fontSize}px sans-serif`;
        const metrics = ctx.measureText(tag.name);
        const textWidth = Math.ceil(metrics.width);
        const textHeight = Math.ceil(fontSize * 1.2);

        // 目标位置 (Target Position)
        let targetX = width / 2;
        let targetY = height / 2;
        
        if (tag.lon !== undefined && tag.lat !== undefined) {
            // 相对于中心的映射
            const dx = (tag.lon - centerLon) * factorX;
            const dy = (tag.lat - centerLat) * factorY;
            
            targetX = width / 2 + dx * scale;
            targetY = height / 2 - dy * scale; // Y 轴反转，因为屏幕 Y 向下，纬度向上
        }

        // 初始位置增加微小随机抖动，防止完全重叠的点卡死
        const jitter = (Math.random() - 0.5) * 2; 

        return {
            ...tag,
            fontSize,
            width: textWidth,
            height: textHeight,
            targetX,
            targetY,
            x: targetX + jitter, // 初始位置在目标附近
            y: targetY + jitter,
            vx: 0,
            vy: 0
        };
    });

    // 合并中心标签
    const allNodes = [centerTag, ...processedTags];

    // 4. D3 力导向模拟 (Force Simulation)
    // 使用自定义矩形碰撞检测以获得更紧凑的布局
    const simulation = d3.forceSimulation(allNodes)
        .force('x', d3.forceX(d => d.isCenter ? width/2 : d.targetX).strength(0.2)) // 增强引力以保持地理位置
        .force('y', d3.forceY(d => d.isCenter ? height/2 : d.targetY).strength(0.2))
        .alphaDecay(0.05) // 加快衰减，尽快稳定
        .stop();

    // 自定义象限约束力 (Quadrant Constraint Force)
    // 强制标签尽量保持在相对于中心的正确地理象限内
    const forceQuadrant = (alpha) => {
        const k = alpha * 0.5; // 力度系数
        for (const d of allNodes) {
            if (d.isCenter) continue;
            
            // 判断地理方向
            const isEast = (d.lon - centerLon) > 0;
            const isNorth = (d.lat - centerLat) > 0;

            // 屏幕中心
            const cx = width / 2;
            const cy = height / 2;

            // X轴约束 (东 -> 右, 西 -> 左)
            if (isEast && d.x < cx) {
                d.vx += (cx - d.x) * k;
            } else if (!isEast && d.x > cx) {
                d.vx += (cx - d.x) * k;
            }

            // Y轴约束 (北 -> 上, 南 -> 下)
            // 注意屏幕坐标 Y 向下增加，所以北(lat>0)应该对应 Y < cy
            if (isNorth && d.y > cy) {
                d.vy += (cy - d.y) * k;
            } else if (!isNorth && d.y < cy) {
                d.vy += (cy - d.y) * k;
            }
        }
    };

    // 自定义矩形碰撞检测 (Custom Rectangular Collision)
    const rectCollide = (alpha) => {
        const nodes = allNodes;
        const strength = 1; 
        const iterations = 2; // 单次调用的迭代次数，外部循环会多次调用
        const padding = 1; // 最小化间隙的同时保持紧凑

        for (let k = 0; k < iterations; k++) {
            for (let i = 0; i < nodes.length; i++) {
                const a = nodes[i];
                for (let j = i + 1; j < nodes.length; j++) {
                    const b = nodes[j];
                    
                    const aw = a.width / 2 + padding;
                    const ah = a.height / 2 + padding;
                    const bw = b.width / 2 + padding;
                    const bh = b.height / 2 + padding;
                    
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const absDx = Math.abs(dx);
                    const absDy = Math.abs(dy);
                    
                    const ox = (aw + bw) - absDx;
                    const oy = (ah + bh) - absDy;
                    
                    if (ox > 0 && oy > 0) {
                        if (ox < oy) {
                            const moveX = ox * strength;
                            const sign = dx > 0 ? 1 : -1;
                            
                            if (a.fx !== undefined) {
                                b.x += sign * moveX;
                                b.vx += sign * moveX * 0.5;
                            } else if (b.fx !== undefined) {
                                a.x -= sign * moveX;
                                a.vx -= sign * moveX * 0.5;
                            } else {
                                a.x -= sign * moveX * 0.5;
                                b.x += sign * moveX * 0.5;
                                a.vx -= sign * moveX * 0.5;
                                b.vx += sign * moveX * 0.5;
                            }
                        } else {
                            const moveY = oy * strength;
                            const sign = dy > 0 ? 1 : -1;
                            
                            if (a.fx !== undefined) {
                                b.y += sign * moveY;
                                b.vy += sign * moveY * 0.5;
                            } else if (b.fx !== undefined) {
                                a.y -= sign * moveY;
                                a.vy -= sign * moveY * 0.5;
                            } else {
                                a.y -= sign * moveY * 0.5;
                                b.y += sign * moveY * 0.5;
                                a.vy -= sign * moveY * 0.5;
                                b.vy += sign * moveY * 0.5;
                            }
                        }
                    }
                }
            }
        }
    };

    // 运行多阶段模拟
    // 阶段 1: 动态模拟 (Dynamic Simulation)
    const simSteps = 300;
    const iterationsPerTick = 3; // 每帧运行多次碰撞检测

    for (let i = 0; i < simSteps; ++i) {
        simulation.tick();
        const alpha = simulation.alpha();
        forceQuadrant(alpha); // 应用象限约束
        for (let k = 0; k < iterationsPerTick; k++) {
            rectCollide(alpha);
        }
    }

    // 阶段 2: 静态清理 (Static Cleanup)
    // 关闭引力，仅运行碰撞检测以消除残余重叠
    const cleanupSteps = 120;
    for (let i = 0; i < cleanupSteps; ++i) {
        for (let k = 0; k < iterationsPerTick; k++) {
            rectCollide(0);
        }
    }

    // 6. 返回结果
    const results = allNodes.map(d => ({
        ...d,
        text: d.name, // 确保 text 属性存在
        rotation: 0,   // 此模式下不旋转
        placed: true
    }));

    self.postMessage(results);
}
