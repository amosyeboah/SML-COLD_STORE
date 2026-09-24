const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else { 
            if (file.endsWith('.tsx') || file.endsWith('.ts')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk('./src');
let matches = [];
files.forEach(f => {
    const content = fs.readFileSync(f, 'utf8');
    const lines = content.split('\n');
    let modified = false;
    lines.forEach((l, i) => {
        if (/medicine|pharmacy/i.test(l)) {
            if (
                />[^<]*(medicine|pharmacy)[^<]*</i.test(l) || 
                /placeholder=.*(medicine|pharmacy)/i.test(l) || 
                /label=.*(medicine|pharmacy)/i.test(l) || 
                /title=.*(medicine|pharmacy)/i.test(l) || 
                /toast\..*(medicine|pharmacy)/i.test(l) || 
                /text-[^>]*>(medicine|pharmacy)/i.test(l) || 
                /['"`].*(medicine|pharmacy).*['"`]/i.test(l) ||
                /label:\s*['"`].*(medicine|pharmacy).*['"`]/i.test(l)
            ) {
                // To avoid variable names, only match strings or JSX text.
                matches.push(`${f}:${i+1}:${l.trim()}`);
            }
        }
    });
});
fs.writeFileSync('matches.txt', matches.join('\n'));
console.log("Done");
