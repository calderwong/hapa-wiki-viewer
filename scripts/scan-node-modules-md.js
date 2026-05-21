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
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes('translateY(-5px)') || content.includes('slideDown') || content.includes('sub-home-container')) {
          matches.push(full);
        }
      } catch (err) {}
    }
  }
}

walk(rootDir);
console.log("Matches in hapa-wiki-viewer markdown files:", matches);
