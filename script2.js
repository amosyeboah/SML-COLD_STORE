const fs = require('fs');
const path = require('path');
function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { results = results.concat(walk(file)); }
        else { if (file.endsWith('.tsx') || file.endsWith('.ts')) results.push(file); }
    });
    return results;
}
const files = walk('./src');
let output = '';
files.forEach(f => {
    const content = fs.readFileSync(f, 'utf8');
    const lines = content.split('\n');
    lines.forEach((l, i) => {
        if (/medicine/i.test(l) && !/medicine\./i.test(l) && !/\.medicine/i.test(l) && !/medicineId/i.test(l) && !/setMedicine/i.test(l) && !/medicines/i.test(l) && !/queryClient/i.test(l) && !/queryFn/i.test(l) && !/import /i.test(l) && !/export /i.test(l)) {
            if (/>[^<]*medicine[^<]*</i.test(l) || /placeholder=.*medicine/i.test(l) || /label=.*medicine/i.test(l) || /title=.*medicine/i.test(l) || /['"`].*medicine.*['"`]/i.test(l)) {
                output += `${f}:${i+1}:${l.trim()}\n`;
            }
        }
        if (/medicines/i.test(l) && !/medicines\./i.test(l) && !/\.medicines/i.test(l) && !/setMedicines/i.test(l) && !/queryClient/i.test(l) && !/queryFn/i.test(l) && !/import /i.test(l) && !/export /i.test(l)) {
            if (/>[^<]*medicines[^<]*</i.test(l) || /placeholder=.*medicines/i.test(l) || /label=.*medicines/i.test(l) || /title=.*medicines/i.test(l) || /['"`].*medicines.*['"`]/i.test(l)) {
                output += `${f}:${i+1}:${l.trim()}\n`;
            }
        }
    });
});
fs.writeFileSync('matches2.txt', output);
console.log('done');
