import * as THREE from 'three';

// 武汉各区行政区划数据
const wuhanDistricts = {
    "type": "FeatureCollection",
    "name": "武汉市行政区划",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "name": "江岸区",
                "area": "64.24",
                "population": "96.5万",
                "description": "江岸区位于长江北岸，是武汉的政治、经济、文化中心之一。这里拥有汉口江滩、武汉天地等标志性景点，历史悠久，商业繁荣。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.32, 30.62], [114.35, 30.62], [114.36, 30.60], [114.35, 30.58], [114.33, 30.58], [114.31, 30.60], [114.32, 30.62]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "江汉区",
                "area": "28.29",
                "population": "72.9万",
                "description": "江汉区是武汉市的金融商贸中心，拥有江汉路步行街、武广商圈等繁华商业区。这里是百年老汉口的核心区域。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.27, 30.60], [114.30, 30.60], [114.31, 30.58], [114.30, 30.57], [114.28, 30.57], [114.27, 30.59], [114.27, 30.60]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "硚口区",
                "area": "41.46",
                "population": "86.8万",
                "description": "硚口区因汉水入江口处的石桥而得名，是汉正街小商品市场的发源地，素有'天下第一街'的美誉。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.20, 30.59], [114.25, 30.59], [114.26, 30.57], [114.25, 30.55], [114.22, 30.55], [114.20, 30.57], [114.20, 30.59]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "汉阳区",
                "area": "111.54",
                "population": "90.1万",
                "description": "汉阳区位于长江与汉水交汇处南岸，自古有'晴川历历汉阳树'的美誉。龟山电视塔、古琴台、归元寺等名胜坐落于此。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.22, 30.57], [114.28, 30.57], [114.30, 30.55], [114.28, 30.52], [114.24, 30.52], [114.22, 30.54], [114.22, 30.57]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "武昌区",
                "area": "107.76",
                "population": "127.6万",
                "description": "武昌区是湖北省的政治、文化中心，拥有黄鹤楼、东湖、武汉大学等著名景点。这里高校云集，文化底蕴深厚。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.30, 30.58], [114.38, 30.58], [114.40, 30.55], [114.38, 30.52], [114.33, 30.52], [114.30, 30.55], [114.30, 30.58]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "青山区",
                "area": "68.40",
                "population": "52.3万",
                "description": "青山区是武汉重要的工业基地，武钢所在地。近年来，青山江滩的建设让这座工业城区焕发出新的生机。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.38, 30.65], [114.45, 30.65], [114.47, 30.60], [114.45, 30.55], [114.40, 30.55], [114.38, 30.60], [114.38, 30.65]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "洪山区",
                "area": "573.28",
                "population": "175.6万",
                "description": "洪山区是武汉最大的中心城区，拥有华中科技大学、华中师范大学等众多高校，是名副其实的'大学之城'。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.35, 30.55], [114.45, 30.55], [114.50, 30.50], [114.48, 30.45], [114.40, 30.45], [114.35, 30.50], [114.35, 30.55]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "东西湖区",
                "area": "495.00",
                "population": "84.6万",
                "description": "东西湖区是武汉的临空港经济区，拥有武汉天河国际机场，是武汉连接世界的重要门户。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.10, 30.70], [114.25, 30.70], [114.28, 30.65], [114.25, 30.60], [114.15, 30.60], [114.10, 30.65], [114.10, 30.70]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "汉南区",
                "area": "287.00",
                "population": "14.5万",
                "description": "汉南区位于武汉市西南部，是武汉经济开发区的重要组成部分，汽车产业发达，被誉为'中国车都'。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.05, 30.35], [114.15, 30.35], [114.18, 30.30], [114.15, 30.25], [114.08, 30.25], [114.05, 30.30], [114.05, 30.35]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "蔡甸区",
                "area": "1093.17",
                "population": "55.4万",
                "description": "蔡甸区位于武汉市西南部，拥有后官湖、九真山等自然景观，是武汉重要的生态旅游目的地。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.00, 30.60], [114.15, 30.60], [114.18, 30.55], [114.15, 30.50], [114.05, 30.50], [114.00, 30.55], [114.00, 30.60]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "江夏区",
                "area": "2018.31",
                "population": "97.8万",
                "description": "江夏区位于武汉市南部，拥有汤逊湖、梁子湖等湖泊资源，是武汉重要的科技创新和生态宜居区域。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.25, 30.45], [114.45, 30.45], [114.50, 30.35], [114.45, 30.30], [114.30, 30.30], [114.25, 30.35], [114.25, 30.45]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "黄陂区",
                "area": "2261.00",
                "population": "115.2万",
                "description": "黄陂区位于武汉市北部，是武汉面积最大的区，拥有木兰山、木兰天池等著名景区，是花木兰的故乡。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.20, 30.90], [114.45, 30.90], [114.50, 30.80], [114.45, 30.70], [114.30, 30.70], [114.20, 30.80], [114.20, 30.90]]]
            }
        },
        {
            "type": "Feature",
            "properties": {
                "name": "新洲区",
                "area": "1500.00",
                "population": "86.2万",
                "description": "新洲区位于武汉市东北部，拥有道观河、涨渡湖等自然景观，是武汉重要的农业和生态旅游区域。"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[114.50, 30.85], [114.80, 30.85], [114.85, 30.75], [114.80, 30.65], [114.60, 30.65], [114.50, 30.75], [114.50, 30.85]]]
            }
        }
    ]
};

// 场景、相机、渲染器
let scene, camera, renderer;
let districtShapes = [];
let currentDistrictIndex = -1;
let isPlaying = false;
let animationId;

// 字幕动画相关
let subtitleAnimation = {
    isTyping: false,
    text: '',
    currentIndex: 0,
    targetElement: null,
    onComplete: null,
    startTime: 0,
    duration: 0
};

// 描边动画相关
let outlineAnimation = {
    isDrawing: false,
    progress: 0,
    startTime: 0,
    duration: 0
};

// 初始化
function init() {
    // 创建场景
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a12);
    
    // 创建相机
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 60;
    camera = new THREE.OrthographicCamera(
        frustumSize * aspect / -2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        frustumSize / -2,
        1,
        1000
    );
    camera.position.set(0, 0, 100);
    
    // 创建渲染器
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('canvas-container').appendChild(renderer.domElement);
    
    // 创建地图
    createMap();
    
    // 创建区划指示器
    createIndicator();
    
    // 隐藏加载器
    setTimeout(() => {
        document.getElementById('loader').classList.add('hidden');
    }, 500);
    
    // 绑定事件
    bindEvents();
    
    // 开始动画循环
    animate();
}

// 创建地图
function createMap() {
    const features = wuhanDistricts.features;
    
    // 计算中心点和缩放
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    features.forEach(feature => {
        const coords = feature.geometry.coordinates[0];
        coords.forEach(coord => {
            minX = Math.min(minX, coord[0]);
            maxX = Math.max(maxX, coord[0]);
            minY = Math.min(minY, coord[1]);
            maxY = Math.max(maxY, coord[1]);
        });
    });
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const scale = 80;
    
    features.forEach((feature, index) => {
        const coords = feature.geometry.coordinates[0];
        const points = coords.map(coord => {
            return new THREE.Vector2(
                (coord[0] - centerX) * scale,
                (coord[1] - centerY) * scale
            );
        });
        
        // 创建区划形状
        const shape = new THREE.Shape(points);
        const geometry = new THREE.ShapeGeometry(shape);
        
        const material = new THREE.MeshBasicMaterial({
            color: 0x1a2a4a,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { 
            index: index, 
            properties: feature.properties
        };
        
        scene.add(mesh);
        
        districtShapes.push({
            mesh: mesh,
            points: points,
            properties: feature.properties,
            outlineMesh: null,
            particle: null
        });
    });
}

// 创建区划指示器
function createIndicator() {
    const indicator = document.getElementById('indicator');
    districtShapes.forEach((_, index) => {
        const dot = document.createElement('div');
        dot.className = 'indicator-dot';
        dot.addEventListener('click', () => {
            pauseNarration();
            currentDistrictIndex = index;
            highlightDistrict(index);
        });
        indicator.appendChild(dot);
    });
}

// 更新指示器
function updateIndicator() {
    const dots = document.querySelectorAll('.indicator-dot');
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === currentDistrictIndex);
    });
}

// 获取指定进度位置的点
function getPointAtProgress(points, progress) {
    const totalPoints = points.length;
    const scaledProgress = progress * totalPoints;
    const index = Math.floor(scaledProgress) % totalPoints;
    const nextIndex = (index + 1) % totalPoints;
    const segmentProgress = scaledProgress - Math.floor(scaledProgress);
    
    const current = points[index];
    const next = points[nextIndex];
    
    return new THREE.Vector3(
        current.x + (next.x - current.x) * segmentProgress,
        current.y + (next.y - current.y) * segmentProgress,
        1
    );
}

// 创建已完成部分的描边线
function createLineGeometry(points, progress) {
    const totalPoints = points.length;
    const scaledProgress = progress * totalPoints;
    const completeSegments = Math.floor(scaledProgress);
    const segmentProgress = scaledProgress - completeSegments;
    
    const vertices = [];
    
    for (let i = 0; i <= completeSegments && i < totalPoints; i++) {
        const point = points[i % totalPoints];
        vertices.push(point.x, point.y, 1);
    }
    
    if (progress < 1 && completeSegments < totalPoints) {
        const current = points[completeSegments % totalPoints];
        const next = points[(completeSegments + 1) % totalPoints];
        
        const x = current.x + (next.x - current.x) * segmentProgress;
        const y = current.y + (next.y - current.y) * segmentProgress;
        vertices.push(x, y, 1);
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    
    return geometry;
}

// 高亮区划
function highlightDistrict(index, onComplete) {
    // 重置所有区划
    districtShapes.forEach((shape, i) => {
        shape.mesh.material.opacity = 0.2;
        shape.mesh.material.color.setHex(0x1a2a4a);
        if (shape.outlineMesh) {
            scene.remove(shape.outlineMesh);
            shape.outlineMesh.geometry.dispose();
            shape.outlineMesh.material.dispose();
            shape.outlineMesh = null;
        }
        if (shape.particle) {
            shape.particle.visible = false;
        }
    });
    
    if (index >= 0 && index < districtShapes.length) {
        const shape = districtShapes[index];
        
        // 高亮填充
        shape.mesh.material.opacity = 0.35;
        shape.mesh.material.color.setHex(0x2a5a9a);
        
        // 启动同步动画
        startSyncAnimation(shape, onComplete);
        
        // 更新指示器
        updateIndicator();
    }
}

// 启动同步动画
function startSyncAnimation(shape, onComplete) {
    const props = shape.properties;
    const text = props.description;
    
    // 更新UI
    document.getElementById('district-name').textContent = props.name;
    document.querySelector('.stat-value').textContent = props.area;
    document.querySelectorAll('.stat-value')[1].textContent = props.population;
    
    // 更新进度环
    const progress = ((currentDistrictIndex + 1) / districtShapes.length);
    const circle = document.getElementById('progress-circle');
    const circumference = 2 * Math.PI * 20;
    circle.style.strokeDashoffset = circumference * (1 - progress);
    document.getElementById('progress-text').textContent = `${currentDistrictIndex + 1}/${districtShapes.length}`;
    
    // 激活字幕卡片
    document.getElementById('subtitle-card').classList.add('active');
    
    // 初始化字幕动画
    subtitleAnimation.isTyping = true;
    subtitleAnimation.text = text;
    subtitleAnimation.currentIndex = 0;
    subtitleAnimation.targetElement = document.getElementById('narrative');
    subtitleAnimation.onComplete = onComplete;
    subtitleAnimation.startTime = Date.now();
    subtitleAnimation.duration = Math.max(2000, Math.min(6000, text.length * 100));
    subtitleAnimation.targetElement.innerHTML = '<span class="cursor"></span>';
    
    // 初始化描边动画
    outlineAnimation.isDrawing = true;
    outlineAnimation.progress = 0;
    outlineAnimation.startTime = Date.now();
    outlineAnimation.duration = subtitleAnimation.duration;
    
    // 创建或获取描边粒子
    if (!shape.particle) {
        const particleGeometry = new THREE.CircleGeometry(0.5, 16);
        const particleMaterial = new THREE.MeshBasicMaterial({
            color: 0x00d4ff,
            transparent: true,
            opacity: 1
        });
        shape.particle = new THREE.Mesh(particleGeometry, particleMaterial);
        scene.add(shape.particle);
    } else {
        shape.particle.visible = true;
        shape.particle.material.opacity = 1;
    }
    
    outlineAnimation.currentShape = shape;
}

// 更新字幕动画
function updateSubtitleAnimation() {
    if (!subtitleAnimation.isTyping) return;
    
    const now = Date.now();
    const elapsed = now - subtitleAnimation.startTime;
    const progress = Math.min(elapsed / subtitleAnimation.duration, 1);
    
    const charCount = Math.floor(progress * subtitleAnimation.text.length);
    
    if (charCount > subtitleAnimation.currentIndex) {
        const displayedText = subtitleAnimation.text.substring(0, charCount);
        subtitleAnimation.targetElement.innerHTML = displayedText + '<span class="cursor"></span>';
        subtitleAnimation.currentIndex = charCount;
    }
    
    if (progress >= 1) {
        subtitleAnimation.isTyping = false;
        subtitleAnimation.targetElement.innerHTML = subtitleAnimation.text + '<span class="cursor"></span>';
        
        if (subtitleAnimation.onComplete) {
            subtitleAnimation.onComplete();
        }
    }
}

// 更新描边动画
function updateOutlineAnimation() {
    if (!outlineAnimation.isDrawing) return;
    
    const now = Date.now();
    const elapsed = now - outlineAnimation.startTime;
    const progress = Math.min(elapsed / outlineAnimation.duration, 1);
    
    const shape = outlineAnimation.currentShape;
    if (!shape) return;
    
    outlineAnimation.progress = progress;
    
    const currentPos = getPointAtProgress(shape.points, progress);
    shape.particle.position.copy(currentPos);
    
    if (shape.outlineMesh) {
        scene.remove(shape.outlineMesh);
        shape.outlineMesh.geometry.dispose();
    }
    
    const lineGeometry = createLineGeometry(shape.points, progress);
    const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x00d4ff,
        linewidth: 3,
        transparent: true,
        opacity: 0.9
    });
    
    shape.outlineMesh = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(shape.outlineMesh);
    
    if (progress >= 1) {
        outlineAnimation.isDrawing = false;
        shape.particle.material.opacity = 0;
        shape.particle.visible = false;
    }
}

// 播放解说
function playNarration() {
    if (isPlaying) return;
    
    isPlaying = true;
    const btn = document.getElementById('btn-play');
    btn.textContent = '⏸ 暂停解说';
    btn.classList.add('playing');
    
    currentDistrictIndex = 0;
    playDistrictSequence();
}

// 播放序列
function playDistrictSequence() {
    if (!isPlaying || currentDistrictIndex >= districtShapes.length) {
        if (isPlaying) {
            setTimeout(() => {
                isPlaying = false;
                const btn = document.getElementById('btn-play');
                btn.textContent = '▶ 开始解说';
                btn.classList.remove('playing');
                document.getElementById('subtitle-card').classList.remove('active');
                resetPanel();
            }, 1500);
        }
        return;
    }
    
    highlightDistrict(currentDistrictIndex, () => {
        setTimeout(() => {
            if (isPlaying) {
                currentDistrictIndex++;
                playDistrictSequence();
            }
        }, 1000);
    });
}

// 重置面板
function resetPanel() {
    document.getElementById('district-name').textContent = '武汉市';
    document.getElementById('narrative').innerHTML = '<span class="cursor"></span>';
    document.querySelector('.stat-value').textContent = '8,569';
    document.querySelectorAll('.stat-value')[1].textContent = '1,400万';
    
    const circle = document.getElementById('progress-circle');
    const circumference = 2 * Math.PI * 20;
    circle.style.strokeDashoffset = circumference;
    document.getElementById('progress-text').textContent = '0/13';
    
    document.getElementById('subtitle-card').classList.remove('active');
    
    // 重置指示器
    document.querySelectorAll('.indicator-dot').forEach(dot => {
        dot.classList.remove('active');
    });
    
    // 重置地图
    districtShapes.forEach(shape => {
        shape.mesh.material.opacity = 0.2;
        shape.mesh.material.color.setHex(0x1a2a4a);
        if (shape.outlineMesh) {
            scene.remove(shape.outlineMesh);
            shape.outlineMesh.geometry.dispose();
            shape.outlineMesh = null;
        }
        if (shape.particle) {
            shape.particle.visible = false;
        }
    });
}

// 暂停解说
function pauseNarration() {
    isPlaying = false;
    const btn = document.getElementById('btn-play');
    btn.textContent = '▶ 开始解说';
    btn.classList.remove('playing');
    subtitleAnimation.isTyping = false;
    outlineAnimation.isDrawing = false;
}

// 上一个
function prevDistrict() {
    pauseNarration();
    currentDistrictIndex--;
    if (currentDistrictIndex < 0) {
        currentDistrictIndex = districtShapes.length - 1;
    }
    highlightDistrict(currentDistrictIndex);
}

// 下一个
function nextDistrict() {
    pauseNarration();
    currentDistrictIndex++;
    if (currentDistrictIndex >= districtShapes.length) {
        currentDistrictIndex = 0;
    }
    highlightDistrict(currentDistrictIndex);
}

// 绑定事件
function bindEvents() {
    document.getElementById('btn-play').addEventListener('click', () => {
        if (isPlaying) {
            pauseNarration();
        } else {
            playNarration();
        }
    });
    
    document.getElementById('btn-prev').addEventListener('click', prevDistrict);
    document.getElementById('btn-next').addEventListener('click', nextDistrict);
    
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    renderer.domElement.addEventListener('click', (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(districtShapes.map(s => s.mesh));
        
        if (intersects.length > 0) {
            pauseNarration();
            currentDistrictIndex = intersects[0].object.userData.index;
            highlightDistrict(currentDistrictIndex);
        }
    });
    
    window.addEventListener('resize', () => {
        const aspect = window.innerWidth / window.innerHeight;
        const frustumSize = 60;
        camera.left = frustumSize * aspect / -2;
        camera.right = frustumSize * aspect / 2;
        camera.top = frustumSize / 2;
        camera.bottom = frustumSize / -2;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// 动画循环
function animate() {
    animationId = requestAnimationFrame(animate);
    
    updateSubtitleAnimation();
    updateOutlineAnimation();
    
    renderer.render(scene, camera);
}

// 启动
init();
