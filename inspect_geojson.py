import json
import os

file_path = os.path.join('public', 'data', '道路附属设施.geojson')

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        if data['features']:
            print(json.dumps(data['features'][0]['properties'], ensure_ascii=False, indent=2))
except Exception as e:
    print(f"Error: {e}")
