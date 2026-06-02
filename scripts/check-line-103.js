const fs = require('node:fs');
const path = require('node:path');
const content = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer.css'), 'utf8');
const lines = content.split(/\r?\n/);
for (let i = 85; i < 115; i++) {
  if (i < lines.length) {
    console.log(`${i+1}: ${JSON.stringify(lines[i])}`);
  }
}
