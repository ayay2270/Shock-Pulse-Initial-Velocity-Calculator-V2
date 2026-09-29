/* Loads a browser-style calculations.js file into an isolated Node context. */
const fs = require('fs');
const vm = require('vm');

module.exports = function loadCalculations(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const context = { globalThis: {}, window: {} };
  context.window = context.globalThis;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.globalThis.ShockCalculations;
};
