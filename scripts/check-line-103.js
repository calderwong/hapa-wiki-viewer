const fs = require('node:fs');
const content = fs.readFileSync('/Users/calderwong/Desktop/hapa-wiki-viewer/src/renderer.css', 'utf8');
const lines = content.split(/\r?\n/);
for (let i = 85; i < 115; i++) {
  if (i < lines.length) {
    console.log(`${i+1}: ${JSON.stringify(lines[i])}`);
  }
}
