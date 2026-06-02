const fs = require('node:fs');
const path = require('node:path');
const content = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer.css'), 'utf8');
const lines = content.split('\n');
const line103 = lines[102]; // 0-indexed
console.log("Line 103 content:", JSON.stringify(line103));
console.log("Line 103 hex:");
for (let i = 0; i < line103.length; i++) {
  console.log(`  char[${i}] = ${JSON.stringify(line103[i])} (code: ${line103.charCodeAt(i).toString(16)})`);
}
