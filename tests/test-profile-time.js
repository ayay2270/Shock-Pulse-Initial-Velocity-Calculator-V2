/* eslint-disable no-console */
/* Ported from V1 test-profile-time.js (V2 no longer passes a direction). */
const path = require('path');
const loadCalculations = require('./load-calculations');

const { calculate } = loadCalculations(path.join(__dirname, '..', 'calculations.js'));

const result = calculate({
  dt_s: 0.0001,
  peak_g: 20,
  duration_seconds: 0.007,
  pulse_shape: 'half-sine'
});

function decimalPlaces(step) {
  for (let places = 0; places <= 8; places += 1) {
    const scaled = step * (10 ** places);
    if (Math.abs(scaled - Math.round(scaled)) < 1e-8) return places;
  }
  return 8;
}

function fixed(value, digits) {
  return Number(value).toFixed(digits);
}

const digits = Math.max(0, decimalPlaces(result.dt_s), decimalPlaces(result.duration_s));
const formatTime = (value) => fixed(value, digits);

console.log('Profile points:', result.profile.length);
console.log('First time (s):', formatTime(result.profile[0].time_s));
console.log('Second time (s):', formatTime(result.profile[1].time_s));
console.log('Third time (s):', formatTime(result.profile[2].time_s));
console.log('Last time (s):', formatTime(result.profile[result.profile.length - 1].time_s));
console.log('Second accel:', result.profile[1].acceleration_mm_s2.toFixed(2));
console.log('Chart duration (ms):', result.duration_ms);
console.log('Initial velocity:', result.initial_velocity_mm_s.toFixed(1));

const uniqueTimes = new Set(result.profile.map((p) => formatTime(p.time_s)));
if (uniqueTimes.size !== result.profile.length) {
  throw new Error('Duplicate formatted time values detected');
}

if (formatTime(result.profile[0].time_s) !== '0.0000') throw new Error('Expected first time 0.0000');
if (formatTime(result.profile[1].time_s) !== '0.0001') throw new Error('Expected second time 0.0001');
if (formatTime(result.profile[result.profile.length - 1].time_s) !== '0.0070') throw new Error('Expected last time 0.0070');
if (Math.abs(result.duration_ms - 7) > 1e-9) throw new Error('Expected chart duration 7 ms');

console.log('All profile time checks passed.');
