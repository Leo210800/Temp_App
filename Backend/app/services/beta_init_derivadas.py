"""
Valores iniciales de las curvas Beta a partir de las derivadas de la FDP
(método propuesto por J. Rodríguez Yáñez, nov. 2026).

Pasos:
  1. Suavizar la FDP con un promedio móvil centrado de 5 puntos.
  2. Calcular la 1ª, 2ª y 3ª derivada.
  3. Modas candidatas: cruces de + a − de las tres derivadas. Los valores
     que se repiten (a 1 punto o menos) se cuentan una vez y se toma el menor.
     Si los dos últimos valores de HR crecen, se agrega la curva de saturación
     (moda 100).
  4. Límites A y B: cruces de − a + de la 3ª derivada (mínimos entre modas).
  5. Pesos: diferencia del % acumulado entre A y B. Los entornos con peso
     menor que 1 % se eliminan y su peso pasa al entorno de la derecha.
  6. α y β: posición relativa de la moda en (A, B), buscada en la tabla
     Moda–(α, β). Saturación: α = 3 y β < 1 (0.8 por defecto).
  7. Solapamiento: A y B se abren al menos 2 puntos a cada lado.
  8. Varianza: estima el ancho de la curva; B − A debe ser mayor o igual
     que ese ancho, y si no lo es el entorno se ensancha.

Las etiquetas de cada cruce siguen la notación del documento: "72/73" es un
cruce entre las clases 72 y 73, y como valor se toma el menor (72).
"""
from __future__ import annotations

import numpy as np


def moving_average(y: np.ndarray, window: int = 5) -> np.ndarray:
    """Promedio móvil centrado; en los bordes la ventana se acorta."""
    h = window // 2
    out = np.empty_like(y, dtype=float)
    for i in range(len(y)):
        lo, hi = max(0, i - h), min(len(y), i + h + 1)
        out[i] = float(np.mean(y[lo:hi]))
    return out


def _crossings(d: np.ndarray, labels: np.ndarray, keep: np.ndarray, kind: str) -> list[dict]:
    """kind='max': de + a −; kind='min': de − a +."""
    out = []
    for i in range(len(d) - 1):
        a, b = d[i], d[i + 1]
        hit = (a > 0 and b <= 0) if kind == "max" else (a < 0 and b >= 0)
        if hit and (keep[i] or keep[i + 1]):
            out.append({"par": f"{int(labels[i])}/{int(labels[i + 1])}", "valor": int(labels[i])})
    return out


def _alpha_beta_table(step: float = 0.5, lo: float = 2.0, hi: float = 6.0) -> list[tuple[float, float, float]]:
    vals = np.round(np.arange(lo, hi + 1e-9, step), 4)
    rows = []
    for a in vals:
        for b in vals:
            rows.append((float(a), float(b), float((a - 1.0) / (a + b - 2.0))))
    return rows


def seed_alpha_beta(pos_rel: float, step: float = 0.5) -> tuple[float, float]:
    """Pareja (α, β) cuya moda relativa es la más cercana a pos_rel sin pasarla;
    a igualdad, la de valores más pequeños (≥ 2), como en el documento."""
    if abs(pos_rel - 0.5) < 1e-9:
        return 2.0, 2.0
    table = _alpha_beta_table(step)
    below = [r for r in table if r[2] <= pos_rel + 1e-9] or table
    best = min(below, key=lambda r: (round(pos_rel - r[2], 6), r[0] + r[1], r[0]))
    return best[0], best[1]


def initial_values(
    fdp: list[dict],
    *,
    window: int = 5,
    merge_tol: int = 1,
    min_weight: float = 0.01,
    overlap: float = 2.0,
    ab_step: float = 0.5,
    sat_alpha: float = 3.0,
    sat_beta: float = 0.8,
    use_variance: bool = True,
    keep_frac: float = 0.002,
) -> dict:
    x = np.array([float(d["x"]) for d in fdp])
    y = np.array([float(d["freq"]) for d in fdp])
    labels = np.floor(x + 1e-9).astype(int)          # clase k = [k, k+1)
    total = float(y.sum()) or 1.0

    ys = moving_average(y, window)
    d1 = np.gradient(ys, x)
    d2 = np.gradient(d1, x)
    d3 = np.gradient(d2, x)
    keep = ys >= keep_frac * float(ys.max())          # ignora la zona sin datos

    cruces = {
        "d1_max": _crossings(d1, labels, keep, "max"),
        "d2_max": _crossings(d2, labels, keep, "max"),
        "d3_max": _crossings(d3, labels, keep, "max"),
        "d3_min": _crossings(d3, labels, keep, "min"),
    }

    # ── Modas: unión de los máximos, agrupando valores a ≤ merge_tol ──
    cand = sorted(c["valor"] for k in ("d1_max", "d2_max", "d3_max") for c in cruces[k])
    groups: list[list[int]] = []
    for v in cand:
        if groups and v - groups[-1][-1] <= merge_tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    modas = []
    for g in groups:
        reps = [v for v in set(g) if g.count(v) > 1]
        modas.append(min(reps) if reps else min(g))

    saturacion = len(y) >= 3 and y[-1] > y[-2] > y[-3]
    top = int(labels[-1])
    if saturacion:
        modas = [m for m in modas if m < top - 1]

    # ── Límites (mínimos de la 3ª derivada) ───────────────────────
    lims = sorted({c["valor"] for c in cruces["d3_min"]})

    def cum(b: float) -> float:
        return float(y[x < b].sum()) / total

    # Entornos: [0, l1), [l1, l2), …, [ln, fin]
    edges = [int(labels[0])] + lims + [top + 1]
    entornos = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        ms = [m for m in modas if lo <= m < hi]
        if saturacion and hi == top + 1:
            ms = ms + [100] if not ms or ms[-1] != 100 else ms
        entornos.append({"lo": lo, "hi": hi, "modas": ms, "p": cum(hi) - cum(lo)})

    # Un entorno con varias modas se reparte en el punto medio entre ellas;
    # la saturación siempre ocupa el último entorno sola.
    curvas = []
    for e in entornos:
        ms = e["modas"]
        if not ms:
            curvas.append({"moda": None, "A": e["lo"], "B": e["hi"], "p": e["p"]})
            continue
        if len(ms) == 1:
            curvas.append({"moda": ms[0], "A": e["lo"], "B": e["hi"], "p": e["p"]})
            continue
        cortes = [e["lo"]] + [(a + b) // 2 for a, b in zip(ms[:-1], ms[1:])] + [e["hi"]]
        for m, a, b in zip(ms, cortes[:-1], cortes[1:]):
            curvas.append({"moda": m, "A": a, "B": b, "p": cum(b) - cum(a)})

    # Peso < min_weight (o entorno sin moda) → se suma al entorno de la derecha
    fused: list[dict] = []
    carry = 0.0
    for c in curvas:
        c = dict(c); c["p"] += carry; carry = 0.0
        if c["moda"] is None or c["p"] < min_weight:
            carry = c["p"]
            continue
        fused.append(c)
    if carry and fused:
        fused[-1]["p"] += carry

    # Varianza de los datos dentro de un entorno (en %², HR)
    def var_datos(A: float, B: float) -> float | None:
        m = (x >= A) & (x < B)
        w = y[m]
        if m.sum() < 2 or float(w.sum()) <= 0:
            return None
        mu = float(np.sum(w * x[m]) / w.sum())
        return float(np.sum(w * (x[m] - mu) ** 2) / w.sum())

    # Saturación: A = último límite, B = 100
    out = []
    for i, c in enumerate(fused, start=1):
        sat = c["moda"] == 100
        A, B = float(c["A"]), float(100 if sat else c["B"])
        if sat:
            pos, a, b = 1.0, sat_alpha, sat_beta
        else:
            pos = (c["moda"] - A) / (B - A) if B > A else 0.5
            a, b = seed_alpha_beta(pos, ab_step)
        A_sol = max(float(labels[0]), A - overlap)
        B_sol = 101.0 if sat else min(101.0, B + overlap)

        # La varianza estima el ancho: con (α, β), una Beta de ancho W tiene
        # varianza var01·W². Si el ancho que pide la varianza de los datos es
        # mayor que B − A, se ensancha el entorno manteniendo la posición
        # relativa de la moda (B − A ≥ ancho por varianza).
        var01 = a * b / ((a + b) ** 2 * (a + b + 1.0))
        vd = var_datos(A, B)
        ancho_var = float(np.sqrt(vd / var01)) if (vd and not sat) else None
        ensanchado = False
        if use_variance and ancho_var and ancho_var > (B_sol - A_sol):
            A_sol = max(float(labels[0]), c["moda"] - pos * ancho_var)
            B_sol = min(101.0, A_sol + ancho_var)
            ensanchado = True
        out.append({
            "beta": i, "moda": int(c["moda"]), "A": A, "B": B,
            "p": round(100 * c["p"], 2), "pos_rel": round(pos, 3),
            "alpha": a, "beta_": b, "saturacion": sat,
            "var01": round(var01, 4),
            "ancho_varianza": round(ancho_var, 1) if ancho_var else None,
            "A_sol": round(A_sol, 1), "B_sol": round(B_sol, 1), "ensanchado": ensanchado,
        })

    return {
        "parametros": {"ventana": window, "tolerancia_modas": merge_tol, "peso_minimo": min_weight,
                       "solapamiento": overlap, "paso_tabla": ab_step,
                       "saturacion_alpha": sat_alpha, "saturacion_beta": sat_beta,
                       "usar_varianza": use_variance},
        "cruces": cruces,
        "modas": sorted(set(modas + ([100] if saturacion else []))),
        "limites": lims,
        "acumulado": [{"limite": l, "pct": round(100 * cum(l), 3)} for l in lims],
        "curvas": out,
    }


def fit_from_seeds(fdp: list[dict], curvas: list[dict], *, free_ab: float = 10.0, maxiter: int = 3000) -> dict:
    """Ajuste SLSQP de la mezcla Beta generalizada partiendo de los valores
    iniciales. A y B pueden moverse ±free_ab puntos; los pesos suman 1."""
    from scipy.stats import beta as beta_dist
    from scipy.optimize import minimize

    x = np.array([float(d["x"]) for d in fdp])
    y = np.array([float(d["freq"]) for d in fdp])
    y = y / (y.sum() or 1.0)
    paso = float(x[1] - x[0]) if len(x) > 1 else 1.0

    p0, bounds = [], []
    for c in curvas:
        A0, B0 = c["A_sol"], c["B_sol"]
        if c["saturacion"]:
            p0 += [c["alpha"], c["beta_"], A0, B0]
            bounds += [(1.05, 60.0), (0.05, 0.99), (A0 - free_ab, min(99.0, A0 + free_ab)), (100.5, 106.0)]
        else:
            p0 += [c["alpha"], c["beta_"], A0, B0]
            bounds += [(1.05, 60.0), (1.05, 60.0), (A0 - free_ab, A0 + free_ab), (B0 - free_ab, B0 + free_ab)]
        p0.append(max(c["p"] / 100.0, 0.005)); bounds.append((0.0, 1.0))
    p0 = np.array(p0, float)
    n = len(curvas)

    def comps(p):
        out = []
        for i in range(n):
            a, b, A, B, w = p[5 * i:5 * i + 5]
            if B - A < 1.0:
                out.append(np.zeros_like(x)); continue
            pdf = beta_dist.pdf((x - A) / (B - A), a, b) / (B - A)
            out.append(w * np.nan_to_num(pdf, posinf=0.0) * paso)
        return out

    def cost(p):
        return float(np.mean((y - np.sum(comps(p), axis=0)) ** 2))

    cons = [{"type": "eq", "fun": lambda p: float(np.sum(p[4::5])) - 1.0}]
    res = minimize(cost, p0, method="SLSQP", bounds=bounds, constraints=cons,
                   options={"maxiter": maxiter, "ftol": 1e-13})
    p = res.x
    yhat = np.sum(comps(p), axis=0)
    ss_res = float(np.sum((y - yhat) ** 2)); ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1.0
    ini = np.sum(comps(p0), axis=0)
    ss_ini = float(np.sum((y - ini) ** 2))
    finales = []
    for i, c in enumerate(curvas):
        a, b, A, B, w = (float(v) for v in p[5 * i:5 * i + 5])
        moda = A + (B - A) * (a - 1) / (a + b - 2) if a > 1 and b > 1 else (B if b < 1 else A)
        finales.append({"beta": c["beta"], "alpha": round(a, 3), "beta_": round(b, 3), "A": round(A, 1),
                        "B": round(B, 1), "p": round(100 * w, 2), "moda": round(moda, 1)})
    return {
        "inicial": {"r2": round(1 - ss_ini / ss_tot, 4), "emc": float(ss_ini / len(y)),
                    "err_max": float(np.max(np.abs(y - ini)))},
        "final": {"r2": round(1 - ss_res / ss_tot, 4), "emc": float(ss_res / len(y)),
                  "err_max": float(np.max(np.abs(y - yhat))), "convergio": bool(res.success)},
        "curvas": finales,
        "fdp": [{"x": float(xi), "real": float(yi), "inicial": float(ii), "modelo": float(mi)}
                for xi, yi, ii, mi in zip(x, y, ini, yhat)],
    }
