const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const rootDir = process.env.HAPA_WIKI_PATH || path.join(os.homedir(), 'Desktop', 'Hapa_Worldbuilding_Wiki');
const matches = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile()) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes('sub-home-container')) {
          matches.push(full);
        }
      } catch (err) {
        // Skip binaries/errors
      }
    }
  }
}

walk(rootDir);
console.log("Matches found in Hapa_Worldbuilding_Wiki:", matches);
