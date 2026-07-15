// Derived *physical* quantities from primitive observed/forecast fields.
// All inputs SI-ish: temperature & dew point in °C, RH in %, pressure in hPa.
// We deliberately expose only real thermodynamic quantities — no "feels like",
// heat index, or wind chill (those are human-comfort indices, not physics).

// Saturation vapour pressure over water, hPa. Bolton (1980) — good to ±0.1%
// between -35 and +35 °C, which covers essentially all surface weather.
export function saturationVaporPressure(tempC) {
  return 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
}

// Actual vapour pressure, hPa. Preferred from dew point (most direct); falls
// back to RH * es(T) when dew point is unavailable.
export function vaporPressure({ tempC, dewC, rh }) {
  if (dewC != null && Number.isFinite(dewC)) return saturationVaporPressure(dewC);
  if (tempC != null && rh != null) return (rh / 100) * saturationVaporPressure(tempC);
  return null;
}

// Relative humidity (%) from temp + dew point, when the source didn't give RH.
export function relativeHumidity({ tempC, dewC }) {
  if (tempC == null || dewC == null) return null;
  return 100 * (saturationVaporPressure(dewC) / saturationVaporPressure(tempC));
}

// Wet-bulb temperature (°C) via Stull (2011) empirical fit. Valid for
// 5–99% RH and -20…50 °C at ~sea-level pressure; error typically <0.3 °C.
// We need RH, so derive it from dew point if not supplied.
export function wetBulb({ tempC, dewC, rh }) {
  const T = tempC;
  let RH = rh;
  if (RH == null) RH = relativeHumidity({ tempC, dewC });
  if (T == null || RH == null) return null;
  RH = Math.min(100, Math.max(1, RH));
  return (
    T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) +
    Math.atan(T + RH) -
    Math.atan(RH - 1.676331) +
    0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
    4.686035
  );
}

// °C -> °F for display.
export const cToF = (c) => (c == null ? null : (c * 9) / 5 + 32);
export const hPaToInHg = (h) => (h == null ? null : h * 0.0295299830714);
