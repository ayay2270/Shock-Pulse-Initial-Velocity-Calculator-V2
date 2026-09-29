/* eslint-disable no-console */
/* V2 requirement: no direction feature anywhere in the shipped application files. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = ['index.html', 'app.js', 'style.css', 'calculations.js'];
const patterns = [
  // The CSS layout property `flex-direction` is not a shock-direction reference.
  { name: 'the word "direction"', re: /(?<!flex-)direction/i },
  { name: 'axis sign labels (+X, -Y, −Z …)', re: /(^|[^A-Za-z0-9_])[+\-−][XYZ](?![A-Za-z0-9_])/ },
  { name: '"along" axis wording', re: /\balong\s*[+\-−]?[XYZ]\b/ }
];

const failures = [];
files.forEach((file) => {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    patterns.forEach(({ name, re }) => {
      if (re.test(line)) failures.push(`${file}:${i + 1} contains ${name}: ${line.trim()}`);
    });
  });
});

if (failures.length) {
  console.error(failures.join('\n'));
  throw new Error(`${failures.length} direction reference(s) found`);
}
console.log(`No direction UI or axis-sign labels in ${files.join(', ')}.`);
