const fs = require('fs');
const content = fs.readFileSync('src/App.css', 'utf8');

// Fix multi-line transitions to single line
const fixed = content.replace(/transition:\s*\n\s*([^;]+?var\(--t-[^)]+\)[^;]*?);/g, 'transition: $1;');

fs.writeFileSync('src/App.css', fixed);
console.log('Fixed multi-line transitions');