import json
import os
import shutil

# 配置路径 - 根据用户指示
SOURCE_FILE = os.path.join('public', 'split_data', '地名地址信息', '门牌信息', '楼栋号.geojson')
OUTPUT_BASE_DIR = os.path.join('public', 'split_data', '地名地址信息', '楼栋号')
CATALOG_FILE = os.path.join('public', 'split_data', 'catalog.json')

def safe_name(name):
    """清理文件名"""
    return name.strip() or "其他区域"

def main():
    if not os.path.exists(SOURCE_FILE):
        print(f"Error: Source file not found: {SOURCE_FILE}")
        return

    print(f"Reading source file: {SOURCE_FILE}...")
    try:
        with open(SOURCE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    features = data.get('features', [])
    print(f"Total features: {len(features)}")

    # 1. 按 adname 分组
    grouped_features = {}
    adnames = set()

    for feature in features:
        props = feature.get('properties', {})
        # 优先使用 adname，如果没有则尝试其他字段，最后归为"其他"
        adname = props.get('adname') or props.get('district') or props.get('区县') or '其他区域'
        adname = safe_name(str(adname))
        
        if adname not in grouped_features:
            grouped_features[adname] = []
            adnames.add(adname)
        
        grouped_features[adname].append(feature)

    print(f"Found {len(adnames)} districts: {adnames}")

    # 2. 创建输出目录
    if os.path.exists(OUTPUT_BASE_DIR):
        print(f"Cleaning existing directory: {OUTPUT_BASE_DIR}")
        shutil.rmtree(OUTPUT_BASE_DIR)
    os.makedirs(OUTPUT_BASE_DIR)

    # 3. 写入分割后的 GeoJSON
    for adname, feats in grouped_features.items():
        output_file = os.path.join(OUTPUT_BASE_DIR, f"{adname}.geojson")
        print(f"Writing {adname}: {len(feats)} features -> {output_file}")
        
        geojson_obj = {
            "type": "FeatureCollection",
            "features": feats
        }
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(geojson_obj, f, ensure_ascii=False)

    # 4. 更新 catalog.json
    print("Updating catalog.json...")
    with open(CATALOG_FILE, 'r', encoding='utf-8') as f:
        catalog = json.load(f)

    # 查找"地名地址信息"大类节点
    big_node = next((item for item in catalog if item['value'] == '地名地址信息'), None)
    
    if big_node:
        # a. 移除 "门牌信息" 下的 "楼栋号" (如果门牌信息下只有楼栋号，可能也要移除门牌信息？保险起见只操作楼栋号)
        mid_node_door = next((item for item in big_node['children'] if item['value'] == '门牌信息'), None)
        if mid_node_door:
            # 过滤掉 children 中的 '楼栋号'
            mid_node_door['children'] = [c for c in mid_node_door['children'] if c['value'] != '楼栋号']
            # 如果门牌信息空了，是否移除？可保留以防有其他数据
            if not mid_node_door['children']:
                print("Note: '门牌信息' category is now empty.")
        
        # b. 添加新的 "楼栋号" 中类节点
        # 先检查是否已存在
        mid_node_building = next((item for item in big_node['children'] if item['value'] == '楼栋号'), None)
        if not mid_node_building:
            mid_node_building = {
                "value": "楼栋号",
                "label": "楼栋号",
                "children": []
            }
            big_node['children'].append(mid_node_building)
        
        # 将分割出的 regions 设为子节点 (leaf)
        # 清空现有的（因为我们是全量生成的）
        mid_node_building['children'] = []
        
        sorted_adnames = sorted(list(adnames))
        for adname in sorted_adnames:
            mid_node_building['children'].append({
                "value": adname,
                "label": adname
            })
            
        print(f"Updated catalog with {len(sorted_adnames)} sub-categories under '楼栋号'")
        
        with open(CATALOG_FILE, 'w', encoding='utf-8') as f:
            json.dump(catalog, f, ensure_ascii=False, indent=2)
            
    else:
        print("Error: '地名地址信息' category not found in catalog!")

    # 5. (可选) 删除原文件？为了安全起见，先保留，让用户手动删或通过 git 处理
    print("Done. Split complete.")

if __name__ == "__main__":
    main()
