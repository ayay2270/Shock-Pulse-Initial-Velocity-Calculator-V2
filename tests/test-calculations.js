/* eslint-disable no-console */
/* Reference values, validation, and exact parity with the V1 calculation engine. */
const path = require('path');
const assert = require('assert');
const loadCalculations = require('./load-calculations');

const v2 = loadCalculations(path.join(__dirname, '..', 'calculations.js'));
const v1 = loadCalculations(path.join(__dirname, 'fixtures', 'v1-calculations.js'));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log('Reference cases');

check('A. half-sine 20 G, 7 ms, dt 0.0001 s', () => {
  const r = v2.calculate({ peak_g: 20, duration_seconds: 0.007, dt_s: 0.0001, pulse_shape: 'half-sine' });
  assert.strictEqual(Math.round(r.peak_acceleration_mm_s2), 196133);
  assert.strictEqual(r.delta_v_m_s.toFixed(3), '0.874');
  assert.strictEqual(r.initial_velocity_mm_s.toFixed(1), '874.0');
  assert.ok(Math.abs(r.delta_v_m_s - (2 * 20 * 9.80665 * 0.007) / Math.PI) < 1e-12);
  assert.strictEqual(r.profile_points, 71);
  assert.strictEqual(r.profile[0].acceleration_mm_s2, 0);
  assert.strictEqual(r.profile[70].acceleration_mm_s2, 0);
  assert.ok(Math.abs(r.profile[35].acceleration_mm_s2 - r.peak_acceleration_mm_s2) < 1e-6);
  assert.ok(r.profile.every((p) => p.acceleration_mm_s2 >= 0), 'profile is positive magnitude');
});

check('B. rectangular 20 G, 7 ms, dt 0.0001 s', () => {
  const r = v2.calculate({ peak_g: 20, duration_seconds: 0.007, dt_s: 0.0001, pulse_shape: 'rectangular' });
  assert.strictEqual(r.delta_v_m_s.toFixed(4), '1.3729');
  assert.strictEqual(r.initial_velocity_mm_s.toFixed(1), '1372.9');
  assert.strictEqual(r.profile_points, 71);
  assert.ok(r.profile.every((p) => Math.abs(p.acceleration_mm_s2 - r.peak_acceleration_mm_s2) < 1e-6));
});

check('endpoint is appended when duration is not a multiple of dt', () => {
  const r = v2.calculate({ peak_g: 10, duration_seconds: 0.00705, dt_s: 0.0001, pulse_shape: 'half-sine' });
  assert.strictEqual(r.profile[r.profile.length - 1].time_s, 0.00705);
  assert.strictEqual(r.profile_points, 72);
});

check('result object carries no direction field', () => {
  const r = v2.calculate({ peak_g: 20, duration_seconds: 0.007, dt_s: 0.0001, pulse_shape: 'half-sine' });
  assert.ok(!('direction' in r));
});

console.log('Validation');
const bad = [
  [{ peak_g: 0, duration_seconds: 0.007, dt_s: 0.0001, pulse_shape: 'half-sine' }, /Peak acceleration must be greater than 0/],
  [{ peak_g: 20, duration_seconds: 0, dt_s: 0.0001, pulse_shape: 'half-sine' }, /Duration must be greater than 0/],
  [{ peak_g: 20, duration_seconds: 0.007, dt_s: 0, pulse_shape: 'half-sine' }, /dt must be greater than 0/],
  [{ peak_g: 20, duration_seconds: 0.007, dt_s: 0.01, pulse_shape: 'half-sine' }, /dt must be less than or equal to Duration/],
  [{ peak_g: 20, duration_seconds: 1, dt_s: 0.000001, pulse_shape: 'half-sine' }, /Too many profile points/],
  [{ peak_g: 20, duration_seconds: 0.007, dt_s: 0.0001, pulse_shape: 'triangle' }, /Unsupported pulse shape/]
];
bad.forEach(([input, pattern]) => check(`rejects ${pattern.source}`, () => assert.throws(() => v2.calculate(input), pattern)));

console.log('Parity with V1 engine (profile, CSV, LS-DYNA)');
const cases = [];
['half-sine', 'rectangular'].forEach((shape) => {
  [[20, 0.007, 0.0001], [20, 0.007, 0.00005], [35.5, 0.011, 0.0002], [100, 0.003, 0.00001], [5, 0.0183, 0.0005], [10, 0.00705, 0.0001]]
    .forEach(([g, d, dt]) => cases.push({ peak_g: g, duration_seconds: d, dt_s: dt, pulse_shape: shape }));
});
cases.forEach((input) => check(`${input.pulse_shape} ${input.peak_g} G ${input.duration_seconds} s dt ${input.dt_s}`, () => {
  const a = v1.calculate({ ...input, direction: '-Z' });
  const b = v2.calculate(input);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(b.profile)), JSON.parse(JSON.stringify(a.profile)));
  ['peak_acceleration_mm_s2', 'delta_v_m_s', 'initial_velocity_mm_s', 'profile_points', 'duration_ms', 'dt_s']
    .forEach((k) => assert.strictEqual(b[k], a[k], k));
  assert.strictEqual(v2.profileToCsv(b), v1.profileToCsv(a));
  assert.strictEqual(v2.profileToLsdyna(b), v1.profileToLsdyna(a));
}));

check('CSV and LS-DYNA formats', () => {
  const r = v2.calculate({ peak_g: 20, duration_seconds: 0.007, dt_s: 0.0001, pulse_shape: 'half-sine' });
  const csv = v2.profileToCsv(r).split('\r\n');
  assert.strictEqual(csv[0], 'Time_ms,Acceleration_mm_s2');
  assert.strictEqual(csv.length, 71 + 2);
  const k = v2.profileToLsdyna(r).split('\r\n');
  assert.strictEqual(k[0], '*DEFINE_CURVE');
  assert.strictEqual(k[k.length - 2], '*END');
});

console.log(`All ${passed} calculation checks passed.`);
