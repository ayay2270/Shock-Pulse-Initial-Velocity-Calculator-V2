(function (global) {
  "use strict";

  const STANDARD_GRAVITY = 9.80665;
  const MAX_PROFILE_INTERVALS = 100000;

  function requirePositive(value, message) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(message);
  }

  function cleanZero(value) {
    return Math.abs(value) < 1e-9 ? 0 : value;
  }

  function calculate(input) {
    const peakG = Number(input.peak_g);
    const durationSeconds = Number(input.duration_seconds);
    const dtSeconds = Number(input.dt_s);
    const pulseShape = input.pulse_shape;

    requirePositive(peakG, "Peak acceleration must be greater than 0.");
    requirePositive(durationSeconds, "Duration must be greater than 0.");
    requirePositive(dtSeconds, "dt must be greater than 0.");
    if (dtSeconds > durationSeconds) throw new Error("dt must be less than or equal to Duration.");
    if (durationSeconds / dtSeconds > MAX_PROFILE_INTERVALS) {
      throw new Error("Too many profile points. Please increase dt.");
    }
    if (!['half-sine', 'rectangular'].includes(pulseShape)) throw new Error("Unsupported pulse shape.");

    const accelerationMps2 = peakG * STANDARD_GRAVITY;
    const peakAccelerationMmS2 = accelerationMps2 * 1000;
    const deltaVMps = pulseShape === 'half-sine'
      ? (2 * accelerationMps2 * durationSeconds) / Math.PI
      : accelerationMps2 * durationSeconds;

    const tolerance = Math.max(1e-12, durationSeconds * 1e-12);
    const completeSteps = Math.floor(durationSeconds / dtSeconds + tolerance);
    const times = [];
    for (let index = 0; index <= completeSteps; index += 1) {
      const time = index * dtSeconds;
      if (time <= durationSeconds + tolerance) times.push(Math.min(time, durationSeconds));
    }
    if (Math.abs(times[times.length - 1] - durationSeconds) > tolerance) {
      times.push(durationSeconds);
    } else {
      times[times.length - 1] = durationSeconds;
    }

    const lastIndex = times.length - 1;
    const profile = times.map((timeSeconds, index) => {
      let normalized;
      if (pulseShape === 'half-sine') {
        normalized = index === 0 || index === lastIndex
          ? 0
          : Math.sin(Math.PI * timeSeconds / durationSeconds);
      } else {
        normalized = 1;
      }
      return {
        time_s: timeSeconds,
        time_ms: timeSeconds * 1000,
        acceleration_mm_s2: cleanZero(peakAccelerationMmS2 * normalized)
      };
    });

    return {
      peak_g: peakG,
      pulse_shape: pulseShape,
      direction: input.direction || '-Z',
      solver_unit: 'N-mm-s-tonne',
      duration_s: durationSeconds,
      duration_ms: durationSeconds * 1000,
      dt_s: dtSeconds,
      dt_ms: dtSeconds * 1000,
      delta_v_m_s: deltaVMps,
      initial_velocity_mm_s: deltaVMps * 1000,
      peak_acceleration_mm_s2: peakAccelerationMmS2,
      profile_points: profile.length,
      profile
    };
  }

  function exportNumber(value, digits) {
    return Number(value.toFixed(digits)).toString();
  }

  function profileToCsv(result) {
    const lines = ['Time_ms,Acceleration_mm_s2'];
    result.profile.forEach((point) => {
      lines.push(`${exportNumber(point.time_ms, 9)},${exportNumber(point.acceleration_mm_s2, 6)}`);
    });
    return `${lines.join('\r\n')}\r\n`;
  }

  function profileToLsdyna(result) {
    const lines = [
      '*DEFINE_CURVE',
      '$#    lcid',
      '         1',
      '$#                a1                  o1',
      '$# Time unit: second; Acceleration unit: mm/s^2 (N-mm-s-tonne)'
    ];
    result.profile.forEach((point) => {
      lines.push(`${point.time_s.toFixed(9).padStart(18)}${point.acceleration_mm_s2.toFixed(6).padStart(22)}`);
    });
    lines.push('*END');
    return `${lines.join('\r\n')}\r\n`;
  }

  global.ShockCalculations = Object.freeze({
    STANDARD_GRAVITY,
    MAX_PROFILE_INTERVALS,
    calculate,
    profileToCsv,
    profileToLsdyna
  });
})(typeof window !== 'undefined' ? window : globalThis);
