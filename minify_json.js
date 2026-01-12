const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "public", "data", "购物服务.geojson");
const stat = fs.statSync(filePath);
console.log(`Original size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

try {
  const content = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(content);
  // stringify with no whitespace
  const compressed = JSON.stringify(json);
  fs.writeFileSync(filePath, compressed);

  const newStat = fs.statSync(filePath);
  console.log(`Compressed size: ${(newStat.size / 1024 / 1024).toFixed(2)} MB`);
} catch (err) {
  console.error("Error processing file:", err);
}
