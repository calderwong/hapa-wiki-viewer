const fs = require('node:fs');
const path = require('node:path');

const rootDir = '/Users/calderwong/Desktop/hapa-wiki-viewer';
const matches = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name === 'renderer.css') {
      matches.push(full);
    }
  }
}

walk(rootDir);
console.log("All renderer.css files found:", matches);
for (const f of matches) {
  const stat = fs.statSync(f);
  console.log(`File: ${f}, Size: ${stat.size} bytes`);
  const content = fs.readFileSync(f, 'utf8');
  console.log("Line 103 content:", content.split('\n')[102] || "N/A");
}
