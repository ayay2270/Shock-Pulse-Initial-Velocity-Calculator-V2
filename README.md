# Shock Pulse / Initial Velocity Calculator — V2

Browser-only engineering tool that converts a shock pulse (peak acceleration + duration) into an **estimated initial velocity** and a **solver-ready acceleration profile**.

**Live:** https://ayay2270.github.io/Shock-Pulse-Initial-Velocity-Calculator-V2/

V1 (unchanged): https://ayay2270.github.io/Shock-Pulse-Initial-Velocity-Calculator/

## V2 concept — Shock Pulse Workbench

- The waveform is the editor: drag the **Peak** handle vertically or the **Duration** handle horizontally (or focus a handle and use the arrow keys). The inputs, waveform and results stay in sync.
- Live calculation — no Calculate button.
- Result chain: **Peak acceleration → Integrated velocity change → Estimated initial velocity**.
- Profile data, export and the engineering note live in a collapsible bottom drawer.
- The calculator is magnitude-based; V1's direction selector has been removed.

## Pulse shapes and calculation

| Shape | Profile | Velocity change |
|---|---|---|
| Half-sine | a(t) = A · sin(π t / T) | ΔV = 2 A T / π |
| Rectangular | a(t) = A | ΔV = A T |

A = peak acceleration (G × 9.80665 m/s²), T = pulse duration. The estimated initial velocity equals ΔV and is shown in mm/s (N-mm-s-tonne).

Reference: half-sine, 20 G, 7 ms, dt = 0.0001 s → 196 133 mm/s² peak, ΔV 0.874 m/s, initial velocity 874.0 mm/s, 71 profile points.

## Profile and export

- Profile table: Time (s), Acceleration (mm/s²); the pulse endpoint is always included.
- **Copy Profile Table** (tab-separated, pastes into Excel)
- **Export CSV** — `shock_profile.csv` (Time_ms, Acceleration_mm_s2)
- **Export LS-DYNA Curve** — `shock_profile_lsdyna.k` (`*DEFINE_CURVE`, seconds, mm/s²)

The calculation and export engine (`calculations.js`) is carried over from V1; `tests/test-calculations.js` checks that profiles, CSV and LS-DYNA output are identical to V1.

## Run locally

Static files only — no build step, no dependencies.

```bash
python -m http.server 8000
```

Open http://localhost:8000/. Run the tests with Node.js:

```bash
npm test
```

## Engineering note

The estimated initial velocity is an energy-equivalent starting estimate derived from the pulse area. It does not guarantee the simulated pulse: the actual response depends on stiffness, mass, contact, damping, EPE / foam behavior and structural response. Correlate simulation results against the target pulse.
