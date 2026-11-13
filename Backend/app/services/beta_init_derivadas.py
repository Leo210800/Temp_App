"""
Valores iniciales de las curvas Beta a partir de las derivadas de la FDP
(método propuesto por J. Rodríguez Yáñez, nov. 2026).

Pasos:
  1. Suavizar la FDP con un promedio móvil centrado de 5 puntos.
  2. Por defecto ("excel"), sin suavizar: cada derivada es la PENDIENTE de
     Excel sobre las 5 filas que terminan en la fila i (i−4 … i), como en la
     hoja de J. Rodríguez Yáñez; así se reproducen sus cruces de Belén. Opción "pendiente": calcular la 1ª, 2ª y 3ª derivada como la pendiente cada 5 puntos
     (y[i+2] − y[i−2]) / (x[i+2] − x[i−2]), igual que en la hoja de cálculo
     de J. Rodríguez Yáñez. Esa pendiente ya suaviza cada derivada.
  3. Modas candidatas: cruces de + a − de las tres derivadas. Los valores
     vecinos (a 1 punto o menos) se cuentan una vez: manda el de la derivada de
     menor orden; si no, el que se repite; si no, el menor.
     Con "una moda por entorno", entre dos límites A–B queda una sola moda:
     la de la 1ª derivada; si no hay, la de la 2ª; si no, la de la 3ª.
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


def slope(y: np.ndarray, x: np.ndarray, window: int = 5) -> np.ndarray:
    """Pendiente cada `window` puntos: (y[i+h] − y[i−h]) / (x[i+h] − x[i−h]),
    con h = window // 2; en los bordes la ventana se acorta."""
    h = max(1, window // 2)
    n = len(y)
    out = np.zeros(n, dtype=float)
    for i in range(n):
        lo, hi = max(0, i - h), min(n - 1, i + h)
        if hi > lo:
            out[i] = (y[hi] - y[lo]) / (x[hi] - x[lo])
    return out


def slope_excel(y: np.ndarray, x: np.ndarray, window: int = 5) -> np.ndarray:
    """Como PENDIENTE() de Excel sobre las `window` filas que terminan en la
    fila i (i−4 … i), igual que la hoja de J. Rodríguez Yáñez. Con esto la app
    reproduce sus cruces de Belén. Al inicio de la serie la ventana se acorta."""
    n = len(y)
    out = np.zeros(n, dtype=float)
    for i in range(n):
        lo = max(0, i - window + 1)
        if i - lo >= 1:
            out[i] = float(np.polyfit(x[lo:i + 1], y[lo:i + 1], 1)[0])
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


def _alpha_beta_table(step: float = 0.5, lo: float = 1.0, hi: float = 6.0) -> list[tuple[float, float, float]]:
    """Tabla Moda–(α, β) de 1 a 6 (Javier, reunión de nov. 2026). Se omite
    α = β = 1 (curva plana, sin moda)."""
    vals = np.round(np.arange(lo, hi + 1e-9, step), 4)
    rows = []
    for a in vals:
        for b in vals:
            if a == 1.0 and b == 1.0:
                continue
            rows.append((float(a), float(b), float((a - 1.0) / (a + b - 2.0))))
    return rows


def seed_alpha_beta(pos_rel: float, step: float = 0.5) -> tuple[float, float]:
    """Pareja (α, β) cuya moda relativa es la más cercana a pos_rel sin pasarla;
    a igualdad, la de valores más pequeños."""
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
    sat_beta: float = 0.5,
    use_variance: bool = True,
    keep_frac: float = 0.002,
    derivada: str = "excel",
    una_moda_por_entorno: bool = True,
    orden: int = 3,
) -> dict:
    """`orden` = derivada más alta que se usa (1, 2 o 3). Las modas salen de
    las derivadas hasta ese orden y los límites A/B, de los mínimos de esa
    derivada. Javier recomienda empezar con 1 y subir solo si el ajuste no
    alcanza el R² buscado."""
    orden = max(1, min(3, int(orden)))
    x = np.array([float(d["x"]) for d in fdp])
    y = np.array([float(d["freq"]) for d in fdp])
    labels = np.floor(x + 1e-9).astype(int)          # clase k = [k, k+1)
    total = float(y.sum()) or 1.0

    # "excel": curva cruda y PENDIENTE de las 5 filas anteriores (hoja de Javier)
    ys = y.astype(float) if derivada == "excel" else moving_average(y, window)
    if derivada == "excel":
        d1 = slope_excel(ys, x, window)
        d2 = slope_excel(d1, x, window)
        d3 = slope_excel(d2, x, window)
    elif derivada == "pendiente":
        d1 = slope(ys, x, window)
        d2 = slope(d1, x, window)
        d3 = slope(d2, x, window)
    else:                                            # diferencia de 1 punto
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
    if orden < 3:
        dmin = d1 if orden == 1 else d2
        cruces[f"d{orden}_min"] = _crossings(dmin, labels, keep, "min")
    ordenes = [(o, f"d{o}_max") for o in (1, 2, 3) if o <= orden]

    # ── Modas: unión de los máximos, agrupando valores a ≤ merge_tol ──
    # Cada candidato lleva el orden de su derivada (1, 2 o 3). En un grupo de
    # cruces vecinos manda el de la derivada de menor orden (como en el
    # ejemplo de Belén: 72 de la 1ª sobre 71 de la 2ª y la 3ª); a igualdad,
    # el valor que se repite y, si no, el menor.
    cand = sorted((c["valor"], o) for o, k in ordenes for c in cruces[k])
    groups: list[list[tuple[int, int]]] = []
    for v, o in cand:
        if groups and v - groups[-1][-1][0] <= merge_tol:
            groups[-1].append((v, o))
        else:
            groups.append([(v, o)])
    modas = []
    for g in groups:
        o_min = min(o for _, o in g)
        vals = [v for v, o in g if o == o_min]
        todos = [v for v, _ in g]
        reps = [v for v in set(vals) if todos.count(v) > 1]
        modas.append(min(reps) if reps else min(vals))

    saturacion = len(y) >= 3 and y[-1] > y[-2] > y[-3]
    top = int(labels[-1])
    if saturacion:
        modas = [m for m in modas if m < top - 1]

    # ── Límites (mínimos de la 3ª derivada) ───────────────────────
    lims = sorted({c["valor"] for c in cruces[f"d{orden}_min"]})

    def cum(b: float) -> float:
        """% acumulado hasta el límite b, incluida la clase b (como en la
        hoja de Javier: en Belén 28 → 0.088 %, 47 → 6.495 %, …)."""
        return float(y[x < b + 1].sum()) / total

    # Entornos: [0, l1), [l1, l2), …, [ln, fin]
    inicio = int(labels[np.argmax(keep)]) if keep.any() else int(labels[0])   # donde empiezan los datos
    edges = [inicio] + [l for l in lims if l > inicio] + [top + 1]
    prioridad = [[c["valor"] for c in cruces[k]] for _, k in ordenes]

    def mejor_moda(ms: list[int]) -> list[int]:
        """Una sola moda: la de la derivada de menor orden; a igualdad, la menor."""
        for lista in prioridad:
            hits = [m for m in ms if any(abs(m - v) <= merge_tol for v in lista)]
            if hits:
                return [min(hits)]
        return ms[:1]

    entornos = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        ms = [m for m in modas if lo <= m < hi]
        if una_moda_por_entorno and len(ms) > 1:
            ms = mejor_moda(ms)
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
        # Criterio de J. Rodríguez Yáñez: (B − A)/σ ≥ 4 (entre 3 y 4 aceptable, < 3 revisar),
        # con σ la desviación estándar de los datos del entorno.
        sd = float(np.sqrt(vd)) if vd else None
        ratio = round((B - A) / sd, 2) if (sd and not sat) else None
        ratio_sol = round((B_sol - A_sol) / sd, 2) if (sd and not sat) else None
        out.append({
            "beta": i, "moda": int(c["moda"]), "A": A, "B": B,
            "sigma_datos": round(sd, 2) if sd else None, "ratio_sigma": ratio, "ratio_sigma_sol": ratio_sol,
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
                       "usar_varianza": use_variance, "derivada": derivada,
                       "una_moda_por_entorno": una_moda_por_entorno, "orden": orden},
        "cruces": cruces,
        "modas": sorted({c["moda"] for c in out}),
        "modas_candidatas": sorted(set(modas + ([100] if saturacion else []))),
        "limites": lims,
        "acumulado": [{"limite": l, "pct": round(100 * cum(l), 3)} for l in lims],
        "curvas": out,
    }


def fit_from_seeds(fdp: list[dict], curvas: list[dict], *, free_ab: float = 10.0, maxiter: int = 3000,
                   sat_beta_max: float | None = None) -> dict:
    """Ajuste SLSQP de la mezcla Beta generalizada partiendo de los valores
    iniciales. A y B pueden moverse ±free_ab puntos; los pesos suman 1.

    Cada curva se integra por clase con la CDF (masa exacta en cada clase, sin
    perder área). La curva de saturación usa censura al borde, igual que el
    ajuste principal: toda su masa por encima del borde izquierdo de la última
    clase (incluida la que cae más allá de 100 %) se apila en esa clase. Se
    prueban varias semillas para la saturación y se queda el mejor ajuste."""
    from scipy.stats import beta as beta_dist
    from scipy.optimize import minimize

    x = np.array([float(d["x"]) for d in fdp])
    y = np.array([float(d["freq"]) for d in fdp])
    y = y / (y.sum() or 1.0)
    paso = float(x[1] - x[0]) if len(x) > 1 else 1.0
    bordes = np.append(x - paso / 2.0, x[-1] + paso / 2.0)     # n + 1 bordes
    n = len(curvas)
    sat_flags = [bool(c["saturacion"]) for c in curvas]

    def masa(a, b, A, B, sat):
        if B - A < 1.0:
            return np.zeros_like(x)
        cdf = beta_dist.cdf(np.clip((bordes - A) / (B - A), 0.0, 1.0), a, b)
        m = np.diff(cdf)
        if sat:
            m[-1] = 1.0 - cdf[-2]          # censura: lo que pasa de 100 % va a la clase de 100
        return m

    def comps(p):
        return [p[5 * i + 4] * masa(*p[5 * i:5 * i + 4], sat_flags[i]) for i in range(n)]

    def cost(p):
        return float(np.mean((y - np.sum(comps(p), axis=0)) ** 2))

    def build(sat_seed):
        p0, bounds = [], []
        for c in curvas:
            A0, B0 = c["A_sol"], c["B_sol"]
            if c["saturacion"]:
                a0, b0, Bs = sat_seed if sat_seed else (c["alpha"], c["beta_"], 101.0)
                A0 = min(A0, 98.0)
                b_hi = sat_beta_max if sat_beta_max else 5.0    # β < 1: saturación pegada a 100 %
                b0 = min(b0, b_hi)
                p0 += [a0, b0, A0, Bs]
                bounds += [(1.05, 500.0), (0.05, b_hi), (max(60.0, A0 - 2 * free_ab), 98.0), (100.5, 115.0)]
            else:
                p0 += [c["alpha"], c["beta_"], A0, B0]
                bounds += [(1.05, 60.0), (1.05, 60.0), (A0 - free_ab, A0 + free_ab), (B0 - free_ab, B0 + free_ab)]
            p0.append(max(c["p"] / 100.0, 0.005)); bounds.append((0.0, 1.0))
        return np.array(p0, float), bounds

    cons = [{"type": "eq", "fun": lambda p: float(np.sum(p[4::5])) - 1.0}]
    p_ini, _ = build(None)
    best = None
    # Semillas de la saturación (α, β, B): la del método y las del ajuste principal
    for seed in (None, (3.0, 0.8, 104.0), (2.0, 2.0, 106.0), (8.0, 0.5, 102.0), (1.5, 1.2, 110.0)):
        p0, bounds = build(seed)
        try:
            res = minimize(cost, p0, method="SLSQP", bounds=bounds, constraints=cons,
                           options={"maxiter": maxiter, "ftol": 1e-13})
        except Exception:
            continue
        if best is None or res.fun < best.fun:
            best = res
    res = best
    p = res.x
    yhat = np.sum(comps(p), axis=0)
    ss_res = float(np.sum((y - yhat) ** 2)); ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1.0
    ini = np.sum(comps(p_ini), axis=0)
    ss_ini = float(np.sum((y - ini) ** 2))
    finales = []
    for i, c in enumerate(curvas):
        a, b, A, B, w = (float(v) for v in p[5 * i:5 * i + 5])
        if sat_flags[i]:
            moda = 100.0
        else:
            moda = A + (B - A) * (a - 1) / (a + b - 2) if a > 1 and b > 1 else (B if b < 1 else A)
        var01 = a * b / ((a + b) ** 2 * (a + b + 1.0))
        finales.append({"beta": c["beta"], "alpha": round(a, 3), "beta_": round(b, 3), "A": round(A, 1),
                        "B": round(B, 1), "p": round(100 * w, 2), "moda": round(moda, 1),
                        "ratio_sigma": round(1.0 / float(np.sqrt(var01)), 2)})   # (B − A)/σ de la propia curva
    return {
        "inicial": {"r2": round(1 - ss_ini / ss_tot, 4), "emc": float(ss_ini / len(y)),
                    "err_max": float(np.max(np.abs(y - ini)))},
        "final": {"r2": round(1 - ss_res / ss_tot, 4), "emc": float(ss_res / len(y)),
                  "err_max": float(np.max(np.abs(y - yhat))), "convergio": bool(res.success),
                  "area": round(float(yhat.sum()), 4)},
        "curvas": finales,
        "params": [float(v) for v in p],
        "componentes": [c.tolist() for c in comps(p)],
        "fdp": [{"x": float(xi), "real": float(yi), "inicial": float(ii), "modelo": float(mi)}
                for xi, yi, ii, mi in zip(x, y, ini, yhat)],
    }


# Opciones del "modelo por derivadas" que usa toda la app (FDP, validación,
# TOW y análisis temporal b.3) cuando se elige ese modelo.
MODELO_DERIVADAS = {
    "derivada": "excel",          # curva cruda + PENDIENTE de las 5 filas anteriores
    "una_moda_por_entorno": True,
    "overlap": 6.0,               # solapamiento inicial de A y B (Javier usa 2)
    "sat_beta_max": 0.99,         # la saturación conserva β < 1
    "orden": 3,                   # derivada más alta (Belén necesita la 3ª)
}


def model_from_derivadas(fdp: list[dict], **opts) -> tuple[list[dict], float, float, list[dict]]:
    """Modelo completo con el método de derivadas: valores iniciales + ajuste.

    Devuelve lo mismo que `distribution_fitting._fit_beta_components`
    (betas, r2, mse, fdp con "model", "error_range" y "beta1", "beta2", …),
    para que el resto de la app lo use sin cambios."""
    cfg = {**MODELO_DERIVADAS, **opts}
    init = initial_values(fdp, derivada=cfg["derivada"],
                          una_moda_por_entorno=cfg["una_moda_por_entorno"], overlap=cfg["overlap"],
                          orden=cfg["orden"])
    if not init.get("curvas"):
        return [], None, None, fdp
    fit = fit_from_seeds(fdp, init["curvas"], sat_beta_max=cfg["sat_beta_max"])

    total = float(sum(float(d["freq"]) for d in fdp)) or 1.0      # misma escala que "freq"
    comps = [np.asarray(c) * total for c in fit["componentes"]]
    y_model = np.sum(comps, axis=0)
    y_real = np.array([float(d["freq"]) for d in fdp])

    betas = []
    for i, c in enumerate(fit["curvas"]):
        a, b, A, B, w = fit["params"][5 * i:5 * i + 5]
        width = max(B - A, 1e-6)
        var01 = (a * b) / ((a + b) ** 2 * (a + b + 1.0))
        betas.append({
            "alpha": round(a, 4), "beta": round(b, 4), "A": round(A, 2), "B": round(B, 2),
            "mode": float(np.clip(c["moda"], 0.0, 100.0)),
            "variance": round(float(var01), 6), "variance_hr": round(float(var01 * width ** 2), 4),
            "w": round(w, 4),
        })
    mse = float(np.mean((y_real - y_model) ** 2))
    ss_tot = float(np.sum((y_real - y_real.mean()) ** 2)) or 1.0
    r2 = round(1.0 - float(np.sum((y_real - y_model) ** 2)) / ss_tot, 4)
    fdp_out = []
    for j, d in enumerate(fdp):
        point = {**d, "model": round(float(y_model[j]), 7),
                 "error_range": round(float(y_real[j] - y_model[j]), 7)}
        for i, yc in enumerate(comps):
            point[f"beta{i + 1}"] = round(float(yc[j]), 7)
        fdp_out.append(point)
    return betas, r2, round(mse, 8), fdp_out
