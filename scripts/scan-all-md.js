const fs = require('node:fs');
const path = require('node:path');

const rootDir = '/Users/calderwong/Desktop/hapa-wiki-viewer';

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    if (entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      console.log("Found MD file:", full);
      const content = fs.readFileSync(full, 'utf8');
      console.log("Content snippet:", content.slice(0, 300));
      console.log("------------------------");
    }
  }
}

walk(rootDir);
