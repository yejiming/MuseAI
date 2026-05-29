const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../src/pages/DeAi.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Insert extractSuggestionText helper function
const helperFunc = `
function extractSuggestionText(rawSuggestion: string): string {
  if (!rawSuggestion) return '';
  try {
    const parsed = JSON.parse(rawSuggestion);
    if (typeof parsed?.suggestion === 'string') return parsed.suggestion.trim();
    if (typeof parsed?.优化建议 === 'string') return parsed.优化建议.trim();
  } catch (e) {
    // expected if it's already plain text
  }
  return rawSuggestion.trim();
}
`;
// Insert after imports
content = content.replace(/(import .*;\n)+/, '$&\n' + helperFunc);

// 2. buildDetectorPrompt
content = content.replace(
  /\$\{v\.suggestion!\.trim\(\)\}/g,
  '${extractSuggestionText(v.suggestion!)}'
);

// 3. handleRemoverBeforeStart
content = content.replace(
  /const confirmedSuggestion = persistedSuggestion;/,
  'const confirmedSuggestion = extractSuggestionText(persistedSuggestion || \'\');'
);

// Wait, the filter in handleRemoverBeforeStart also uses v.suggestion
content = content.replace(
  /v\.suggestion\.trim\(\) !== confirmedSuggestion\.trim\(\)/g,
  'extractSuggestionText(v.suggestion!) !== confirmedSuggestion'
);


fs.writeFileSync(file, content);
console.log('Done.');
