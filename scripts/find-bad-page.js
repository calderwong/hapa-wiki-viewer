const { buildWikiIndex } = require('../src/wikiIndexer');
const wikiPath = '/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki';
const index = buildWikiIndex(wikiPath);
console.log("Total pages indexed:", Object.keys(index.pages).length);

for (const [slug, page] of Object.entries(index.pages)) {
  if (page.body.includes('translateY') || page.body.includes('slideDown') || page.body.includes('sub-home-container')) {
    console.log("MATCH FOUND!");
    console.log("Slug:", slug);
    console.log("Path:", page.path);
    console.log("Body snippet:", page.body.slice(0, 500));
  }
}
console.log("Scan complete.");
