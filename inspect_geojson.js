const fs = require('fs');
const path = require('path');

// 读取一个小文件进行测试
const filePath = path.join(__dirname, 'public', 'data', '道路附属设施.geojson');

try {
    const content = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(content);
    if (json.features && json.features.length > 0) {
        console.log('Sample properties:', JSON.stringify(json.features[0].properties, null, 2));
    } else {
        console.log('No features found.');
    }
} catch (err) {
    console.error(err);
}
