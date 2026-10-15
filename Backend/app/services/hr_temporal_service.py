"""
hr_temporal_service.py
======================
Análisis temporal de la Humedad Relativa (HR).

Responde la sección "Análisis de tiempo" del artículo *Estimación de Humedad
Relativa como solapamiento de funciones Beta*: en qué horas del día y en qué
meses aparece cada curva Beta de la FDP de HR.

Todo se calcula al vuelo a partir de las mediciones; este módulo NO escribe en
la base de datos.

Piezas:

  1. FDP por periodo del día (cuartos de 6 h: madrugada 00-05, mañana 06-11,
     tarde 12-17, noche 18-23), con su propio ajuste Beta.
  2. Curvas de densidad por hora (24) y por mes (12), para superponerlas.
  3. Ajuste Beta global y "asignación" de cada medición a las curvas: cada
     valor de HR reparte su peso entre las Betas en proporción a lo que cada
     una aporta en ese bin (responsabilidad = beta_i(x) / modelo(x)). Sumando
     esas responsabilidades por mes y por hora se obtiene cuándo domina cada
     curva.

El ajuste reutiliza `_fit_beta_components` (el mismo de la pantalla de FDP),
así que los resultados globales coinciden con los de esa pantalla.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.services.distribution_fitting import _build_fdp, _fit_beta_components


# Cuartos del día (lógica de cuartiles acordada con Javier).
PERIODS = [
    {"key": "madrugada", "label": "Madrugada (00-05)", "h_from": 0,  "h_to": 5},
    {"key": "manana",    "label": "Mañana (06-11)",    "h_from": 6,  "h_to": 11},
    {"key": "tarde",     "label": "Tarde (12-17)",     "h_from": 12, "h_to": 17},
    {"key": "noche",     "label": "Noche (18-23)",     "h_from": 18, "h_to": 23},
]

# Costa Rica, Valle Central: época seca dic-abr, lluviosa may-nov.
DRY_MONTHS = {12, 1, 2, 3, 4}
DAY_HOURS  = set(range(6, 18))          # 06:00-17:59

SAT_THRESHOLD = 100.0                   # HR >= este valor = saturada
N_COMPONENTS  = 5
SMOOTH_SIGMA  = 1.5                     # suavizado de las curvas (en % HR)


# ═════════════════════════════════════════════════════════════
# Utilidades
# ═════════════════════════════════════════════════════════════

def prepare_frame(rows) -> pd.DataFrame:
    """rows: iterable de (measured_at, value). Devuelve df limpio 0-100 %."""
    df = pd.DataFrame(list(rows), columns=["measured_at", "value"])
    if df.empty:
        return df
    df["measured_at"] = pd.to_datetime(df["measured_at"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["value"])
    df = df[(df["value"] >= 0) & (df["value"] <= 100)].copy()
    df["hour"]  = df["measured_at"].dt.hour
    df["month"] = df["measured_at"].dt.month
    return df


def _period_of_hour(h: int) -> str:
    for p in PERIODS:
        if p["h_from"] <= h <= p["h_to"]:
            return p["key"]
    return PERIODS[-1]["key"]


def _density_curve(values: np.ndarray) -> list[dict]:
    """
    Curva de densidad sobre una rejilla fija de 1 % (0..100), para que todas las
    curvas (por hora, mes o periodo) sean comparables entre sí.
    freq   = fracción de datos en el bin (suma 1)
    smooth = la misma curva con un suavizado gaussiano ligero (como un KDE)
    """
    from scipy.ndimage import gaussian_filter1d

    edges   = np.arange(-0.5, 101.5, 1.0)
    centers = np.arange(0, 101)
    counts, _ = np.histogram(values, bins=edges)
    total = counts.sum() or 1
    freq = counts / total
    smooth = gaussian_filter1d(freq.astype(float), sigma=SMOOTH_SIGMA, mode="nearest")
    s = smooth.sum()
    if s > 0:
        smooth = smooth / s
    return [
        {"x": int(c), "freq": round(float(f), 6), "smooth": round(float(sm), 6)}
        for c, f, sm in zip(centers, freq, smooth)
    ]


def _mode_of_curve(curve: list[dict]) -> float | None:
    if not curve:
        return None
    best = max(curve, key=lambda d: d["smooth"])
    return float(best["x"]) if best["smooth"] > 0 else None


def _fit(values: np.ndarray, censor_sat: bool) -> dict:
    """Ajuste Beta (mismo método que la pantalla de FDP)."""
    if len(values) < 200:
        return {"ok": False, "msg": "Muy pocos datos para ajustar (mínimo 200)."}
    fdp = _build_fdp(values, 1.0)
    if len(fdp) <= 4:
        return {"ok": False, "msg": "Muy pocos bins para ajustar."}
    betas, r2, mse, fdp_fit = _fit_beta_components(
        fdp, n_components=N_COMPONENTS, free_support=True, censor_sat=censor_sat,
    )
    if not betas:
        return {"ok": False, "msg": "El ajuste no convergió."}
    return {"ok": True, "betas": betas, "r2": r2, "mse": mse, "fdp": fdp_fit}


# ═════════════════════════════════════════════════════════════
# Asignación de mediciones a curvas Beta
# ═════════════════════════════════════════════════════════════

def _responsibilities(values: np.ndarray, fdp_fit: list[dict], n_comp: int) -> np.ndarray:
    """
    Matriz (n_values × n_comp): fracción de cada medición que pertenece a cada
    curva, según la masa que cada Beta aporta en el bin de esa medición.
    Filas de ceros = bins donde el modelo vale 0 (sin asignar).
    """
    xs = np.array([d["x"] for d in fdp_fit], dtype=float)
    comp = np.array(
        [[d.get(f"beta{i + 1}", 0.0) for i in range(n_comp)] for d in fdp_fit],
        dtype=float,
    )
    comp = np.clip(comp, 0.0, None)
    tot = comp.sum(axis=1, keepdims=True)
    resp_bin = np.divide(comp, tot, out=np.zeros_like(comp), where=tot > 0)

    paso = float(xs[1] - xs[0]) if len(xs) > 1 else 1.0
    idx = np.floor((values - xs[0]) / paso + 0.5).astype(int)
    idx = np.clip(idx, 0, len(xs) - 1)
    return resp_bin[idx]


def _time_analysis(df: pd.DataFrame, fit: dict) -> dict:
    betas = fit["betas"]
    k = len(betas)
    values = df["value"].to_numpy(dtype=float)
    resp = _responsibilities(values, fit["fdp"], k)

    months = df["month"].to_numpy()
    hours  = df["hour"].to_numpy()

    # Masa de cada curva por (mes, hora)
    mass = np.zeros((k, 12, 24))
    count = np.zeros((12, 24))
    np.add.at(count, (months - 1, hours), 1.0)
    for i in range(k):
        np.add.at(mass[i], (months - 1, hours), resp[:, i])

    total_mass = mass.sum(axis=(1, 2))           # datos "de" cada curva

    components = []
    for i, b in enumerate(betas):
        m_i = mass[i]
        tm = float(total_mass[i]) or 1.0
        by_month = m_i.sum(axis=1)               # 12
        by_hour  = m_i.sum(axis=0)               # 24
        cnt_month = count.sum(axis=1)
        cnt_hour  = count.sum(axis=0)

        dry  = sum(by_month[m - 1] for m in DRY_MONTHS)
        day  = sum(by_hour[h] for h in DAY_HOURS)

        # share = fracción de las mediciones de esa celda que son de la curva
        share_cell = np.divide(m_i, count, out=np.zeros_like(m_i), where=count > 0)

        components.append({
            "index":        i + 1,
            "mode":         b["mode"],
            "w":            b["w"],
            "n_assigned":   round(float(total_mass[i]), 1),
            "peak_month":   int(np.argmax(by_month) + 1),
            "peak_hour":    int(np.argmax(by_hour)),
            "pct_dry":      round(100.0 * dry / tm, 1),
            "pct_rainy":    round(100.0 * (tm - dry) / tm, 1),
            "pct_day":      round(100.0 * day / tm, 1),
            "pct_night":    round(100.0 * (tm - day) / tm, 1),
            # Distribución de la curva en el tiempo (suma 100 %)
            "by_month_pct": [round(100.0 * float(v) / tm, 2) for v in by_month],
            "by_hour_pct":  [round(100.0 * float(v) / tm, 2) for v in by_hour],
            # Presencia de la curva en cada mes / hora (fracción de esas mediciones)
            "share_month":  [round(float(v / c), 4) if c else None for v, c in zip(by_month, cnt_month)],
            "share_hour":   [round(float(v / c), 4) if c else None for v, c in zip(by_hour, cnt_hour)],
            "share_matrix": [[round(float(x), 4) for x in row] for row in share_cell],
        })

    # Curva dominante por celda mes × hora
    dominant = np.argmax(mass, axis=0) + 1                 # (12, 24)
    dominant = np.where(count > 0, dominant, 0)
    unassigned = float(len(values) - resp.sum())

    return {
        "components": components,
        "dominant_matrix": dominant.astype(int).tolist(),   # 0 = sin datos
        "count_matrix": count.astype(int).tolist(),
        "unassigned": round(unassigned, 1),
    }


# ═════════════════════════════════════════════════════════════
# Orquestador
# ═════════════════════════════════════════════════════════════

def _add_period_cols(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["period"] = df["hour"].map(_period_of_hour)
    df["saturated"] = df["value"] >= SAT_THRESHOLD
    return df


def _sat_pct(frame: pd.DataFrame) -> float | None:
    return round(100.0 * float(frame["saturated"].mean()), 2) if len(frame) else None


def fit_global(df: pd.DataFrame, censor_sat: bool = True) -> dict:
    """Ajuste Beta sobre todos los datos (tarda ~20-30 s con 10 años horarios)."""
    return _fit(df["value"].to_numpy(dtype=float), censor_sat=censor_sat)


def analyze_hr_temporal(
    df: pd.DataFrame,
    global_fit: dict | None,
    *,
    exclude_saturated: bool = False,
) -> dict:
    """
    Curvas por periodo, hora y mes + análisis de tiempo de cada curva Beta.
    Es rápido (< 1 s): no ajusta nada. Los ajustes por periodo se piden aparte
    con `fit_period`, porque cada uno tarda ~15 s.

    df:                salida de prepare_frame.
    global_fit:        {"betas", "fdp", "r2", "mse"} del ajuste global (el
                       precalculado de la base o el de `fit_global`). Su `fdp`
                       debe traer las columnas beta1..betaK por bin.
    exclude_saturated: quita HR >= 100 % de las curvas por periodo/hora/mes
                       ("HR no saturada"). El análisis de tiempo usa siempre
                       todos los datos, porque la curva de saturación es una de
                       las 5 Betas.
    """
    df = _add_period_cols(df)
    sub = df[~df["saturated"]] if exclude_saturated else df

    def group_curves(col, keys, full=False):
        out = []
        for key in keys:
            g_all = df[df[col] == key]
            vals = sub.loc[sub[col] == key, "value"].to_numpy(dtype=float)
            curve = _density_curve(vals)
            out.append({
                "key": key,
                "n": int(len(vals)),
                "saturated_pct": _sat_pct(g_all),
                "mode": _mode_of_curve(curve),
                "curve": curve if full else [{"x": d["x"], "smooth": d["smooth"]} for d in curve],
            })
        return out

    periods_out = []
    for p, g in zip(PERIODS, group_curves("period", [p["key"] for p in PERIODS], full=True)):
        periods_out.append({**p, **{k: v for k, v in g.items() if k != "key"}})

    hours_out  = [{"hour":  g.pop("key"), **g} for g in group_curves("hour",  range(24))]
    months_out = [{"month": g.pop("key"), **g} for g in group_curves("month", range(1, 13))]

    time_out = None
    if global_fit and global_fit.get("betas") and global_fit.get("fdp"):
        time_out = _time_analysis(df, global_fit)

    return {
        "n": int(len(df)),
        "date_start": str(df["measured_at"].min()),
        "date_end": str(df["measured_at"].max()),
        "saturated_pct": _sat_pct(df),
        "sat_threshold": SAT_THRESHOLD,
        "exclude_saturated": exclude_saturated,
        "dry_months": sorted(DRY_MONTHS),
        "day_hours": [min(DAY_HOURS), max(DAY_HOURS)],
        "periods": periods_out,
        "hours": hours_out,
        "months": months_out,
        "global_fit": (
            {k: global_fit[k] for k in ("betas", "r2", "mse", "fdp")}
            if global_fit and global_fit.get("betas") else None
        ),
        "time_analysis": time_out,
    }


def fit_period(
    df: pd.DataFrame,
    period_key: str,
    *,
    exclude_saturated: bool = False,
    censor_sat: bool = True,
) -> dict:
    """Ajuste Beta de un solo periodo del día (madrugada, manana, tarde, noche)."""
    period = next((p for p in PERIODS if p["key"] == period_key), None)
    if period is None:
        raise ValueError(f"Periodo desconocido: {period_key}")
    df = _add_period_cols(df)
    g = df[df["period"] == period_key]
    if exclude_saturated:
        g = g[~g["saturated"]]
    vals = g["value"].to_numpy(dtype=float)
    # Sin datos saturados no hay masa en 100 %: la censura XBeta no aplica.
    fit = _fit(vals, censor_sat=censor_sat and not exclude_saturated)
    out = {**period, "n": int(len(vals)), "exclude_saturated": exclude_saturated, "ok": fit["ok"]}
    if fit["ok"]:
        out.update({k: fit[k] for k in ("betas", "r2", "mse", "fdp")})
    else:
        out["msg"] = fit["msg"]
    return out
