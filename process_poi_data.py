import json
import os
import glob
import shutil
from collections import defaultdict

# 配置路径
INPUT_DIR = os.path.join('public', 'data')
OUTPUT_DIR = os.path.join('public', 'split_data')
CATALOG_FILE = os.path.join('public', 'split_data', 'catalog.json')

def safe_name(name):
    """清理文件名，移除非法字符"""
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        name = name.replace(char, '_')
    return name.strip() or "其他"

def main():
    # 1. 初始化输出目录
    if os.path.exists(OUTPUT_DIR):
        print(f"Cleaning existing output directory: {OUTPUT_DIR}")
        shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR)

    # 2. 数据结构：catalog_tree[大类][中类] = set(小类)
    catalog_tree = defaultdict(lambda: defaultdict(set))
    
    # 内存缓存：buffer[大类][中类][小类] = [features]
    # 为了避免内存溢出，我们可能需要按大类处理，或者分批写入。
    # 考虑到总数据量 ~600MB，如果机器内存 > 4GB，一次性处理应该可以。
    # 但为了稳健，我们按输入文件逐个处理。
    
    input_files = glob.glob(os.path.join(INPUT_DIR, '*.geojson'))
    print(f"Found {len(input_files)} input files.")

    for file_path in input_files:
        print(f"Processing {file_path}...")
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            features = data.get('features', [])
            if not features:
                continue

            # 按文件处理，处理完一个大类文件就写入，释放 Feature 内存
            # file_buffer[中类][小类] = [features]
            file_buffer = defaultdict(lambda: defaultdict(list))
            
            current_big_class = ""

            for feature in features:
                props = feature.get('properties', {})
                
                # 获取分类并在为空时提供默认值
                big_cls = safe_name(props.get('大类', '未分类'))
                mid_cls = safe_name(props.get('中类', '其他'))
                small_cls = safe_name(props.get('小类', '其他'))

                current_big_class = big_cls # 假设一个文件只属于一个大类（按现在的命名规则）

                # 更新目录树结构
                catalog_tree[big_cls][mid_cls].add(small_cls)
                
                # 添加到缓存
                file_buffer[mid_cls][small_cls].append(feature)

            # 写入当前文件的所有拆分数据
            if current_big_class:
                big_cls_dir = os.path.join(OUTPUT_DIR, current_big_class)
                
                for mid_cls, small_dict in file_buffer.items():
                    mid_cls_dir = os.path.join(big_cls_dir, mid_cls)
                    os.makedirs(mid_cls_dir, exist_ok=True)
                    
                    for small_cls, feats in small_dict.items():
                        output_path = os.path.join(mid_cls_dir, f"{small_cls}.geojson")
                        
                        # 构建 GeoJSON 对象
                        geojson_obj = {
                            "type": "FeatureCollection",
                            "features": feats
                        }
                        
                        # 如果文件已存在（极少情况，除非多个大类文件有重叠），则追加
                        # 根据逻辑，我们是按输入文件处理，所以如果是首次创建则写入，否则追加（需要读取）
                        # 简化起见，假设输入文件的大类是互斥的，但保险起见还是检查
                        if os.path.exists(output_path):
                            with open(output_path, 'r', encoding='utf-8') as existing_f:
                                existing_data = json.load(existing_f)
                                existing_data['features'].extend(feats)
                                geojson_obj = existing_data
                        
                        with open(output_path, 'w', encoding='utf-8') as out_f:
                            json.dump(geojson_obj, out_f, ensure_ascii=False) # 不缩进以节省空间

        except Exception as e:
            print(f"Error processing {file_path}: {e}")

    # 3. 生成 catalog.json
    print("Generating catalog.json...")
    catalog_list = []
    
    for big, mids in catalog_tree.items():
        big_node = {
            "value": big,
            "label": big,
            "children": []
        }
        
        for mid, smalls in mids.items():
            mid_node = {
                "value": mid,
                "label": mid,
                "children": []
            }
            
            for small in smalls:
                mid_node["children"].append({
                    "value": small,
                    "label": small
                })
            
            big_node["children"].append(mid_node)
        
        catalog_list.append(big_node)

    with open(CATALOG_FILE, 'w', encoding='utf-8') as f:
        json.dump(catalog_list, f, ensure_ascii=False, indent=2)

    print("Done! Data split and catalog generated.")

if __name__ == "__main__":
    main()
