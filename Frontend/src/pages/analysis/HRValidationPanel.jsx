// ─────────────────────────────────────────────────────────────
// Panel de validación del ajuste Beta de HR (sección "Resultados" del
// artículo y pizarra con Javier). Se muestra dentro de la tarjeta
// "FDP — Humedad Relativa" de la pestaña b) FDP.
//
//   1. Real vs modelo con su recta de regresión (a, b, R²)
//   2. Error por bin (real − modelo) con la banda de tolerancia ±1×10⁻³
//   3. FDP con su 1ª y 2ª derivada y los cambios de signo de la 2ª
//   4. % acumulado de datos vs HR (real y modelo)
//   5. Tabla completa por curva (moda, α, β, varianza, A, B, p) en CSV
//   6. Tiempo de humectación (HR ≥ 80 %) de los datos y del modelo
//
// Escala: las frecuencias se muestran multiplicadas por 100 (% de las horas
// en cada bin de 1 %), como pidió Javier. La tolerancia ±1×10⁻³ pasa a ±0.1.
//
// Todo se calcula en el navegador a partir de la FDP que ya devuelve
// /measurements/stats; no hay llamadas nuevas al backend.
// ─────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import {
  LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot,
} from 'recharts'
import { Download } from 'lucide-react'

const BETA_COLORS = ['#8b94a6', '#eab308', '#38bdf8', '#4ade80', '#c084fc']
const FREQ_COLOR = '#ef4444'
const SUM_COLOR = '#e2e8f0'
const SCALE = 100                  // frecuencias × 100 = % de las horas por bin
const ERROR_TARGET = 1e-3 * SCALE  // criterio de error máximo por bin (±1×10⁻³ → ±0.1)
const TOW_HR = 80                  // umbral del tiempo de humectación
const MAX_COLOR = '#ef4444'        // máximo
const MIN_COLOR = '#38bdf8'        // mínimo
const X_TICKS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const tick = { fontSize: 9, fill: '#8b94a6' }
const tipStyle = { background: '#161a21', border: '1px solid #272d37', borderRadius: 8, fontSize: 11 }

// ── Numérica (misma que el backend: scipy gaussian_filter1d + np.gradient) ──
function gaussianFilter1d(y, sigma) {
  const radius = Math.floor(4 * sigma + 0.5)
  const kernel = []
  let s = 0
  for (let k = -radius; k <= radius; k++) { const v = Math.exp(-0.5 * (k / sigma) ** 2); kernel.push(v); s += v }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= s
  const n = y.length
  // modo 'reflect' de scipy: (d c b a | a b c d | d c b a)
  const at = (i) => {
    const p = 2 * n
    let j = ((i % p) + p) % p
    return j < n ? y[j] : y[p - 1 - j]
  }
  return y.map((_, i) => kernel.reduce((acc, kv, k) => acc + kv * at(i + k - radius), 0))
}

function gradient(y, x) {
  const n = y.length
  if (n < 2) return y.map(() => 0)
  return y.map((_, i) => {
    if (i === 0) return (y[1] - y[0]) / (x[1] - x[0])
    if (i === n - 1) return (y[n - 1] - y[n - 2]) / (x[n - 1] - x[n - 2])
    return (y[i + 1] - y[i - 1]) / (x[i + 1] - x[i - 1])
  })
}

function linearFit(xs, ys) {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  const a = sxx ? sxy / sxx : 0
  const b = my - a * mx
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : null
  return { a, b, r2 }
}

// Cambios de signo de la 2ª derivada: (+ → −) inicio de un monte, (− → +) valle
function signChanges(xs, d2) {
  const out = []
  for (let i = 1; i < d2.length; i++) {
    if (d2[i - 1] > 0 && d2[i] <= 0) out.push({ x: xs[i], kind: 'down' })
    if (d2[i - 1] < 0 && d2[i] >= 0) out.push({ x: xs[i], kind: 'up' })
  }
  return out
}

// Ceros de una curva (interpolados entre bins). Para la 1ª derivada:
// + → − es un máximo de la FDP y − → + un mínimo. Para la 2ª derivada son los
// máximos y mínimos de la pendiente (puntos de inflexión de la FDP).
// Se ignoran las zonas casi vacías de la FDP, donde el ruido cruza el cero.
function zeroCrossings(xs, ys, keep) {
  const out = []
  for (let i = 1; i < ys.length; i++) {
    const a = ys[i - 1], b = ys[i]
    if (a === 0 || Math.sign(a) === Math.sign(b) || !keep(i)) continue
    const x = xs[i - 1] + (xs[i] - xs[i - 1]) * (a / (a - b))
    out.push({ x, kind: a > 0 ? 'max' : 'min', i })
  }
  return out
}



// Tooltip de los gráficos de derivadas: además de los valores del bin, lista los
// puntos marcados que caen cerca (los puntos están en posiciones interpoladas,
// por ejemplo 71.2 %, y el cursor salta de bin en bin: 71, 72…).
function DerivTooltip({ active, payload, label, fmt, marks }) {
  if (!active || !payload?.length) return null
  const near = marks.filter(m => Math.abs(m.x - label) <= 0.6)
  return (
    <div style={{ ...tipStyle, padding: '6px 10px' }}>
      <div style={{ color: '#e7eaf0', marginBottom: 2 }}>HR {label}%</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.stroke || p.color }}>{p.name}: {fmt(p.value)}</div>
      ))}
      {near.map((m, i) => (
        <div key={i} style={{ color: m.color, marginTop: 2, fontWeight: 600 }}>● {m.text} {m.x.toFixed(1)} %</div>
      ))}
    </div>
  )
}

function interpRow(rows, x) {
  const j = rows.findIndex(r => r.x >= x)
  if (j <= 0) return rows[0]?.smooth ?? 0
  const a = rows[j - 1], b = rows[j]
  return a.smooth + ((x - a.x) / (b.x - a.x)) * (b.smooth - a.smooth)
}

function downloadCsv(name, rows) {
  const csv = rows.map(r => r.map(v => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v)).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

const Title = ({ children }) => (
  <div style={{ fontSize: 12, color: '#8b94a6', marginBottom: 6, fontWeight: 600 }}>{children}</div>
)

export default function HRValidationPanel({ fdp, betas = [] }) {
  const calc = useMemo(() => {
    if (!fdp?.length) return null
    const xs = fdp.map(p => p.x)
    const real = fdp.map(p => (p.freq ?? 0) * SCALE)
    const model = fdp.map(p => (p.model ?? 0) * SCALE)

    // Derivadas como en _fit_beta_components
    const sigma = Math.max(1.5, xs.length / 60)
    const smooth = gaussianFilter1d(real, sigma)
    const d1 = gradient(smooth, xs)
    const d2 = gradient(d1, xs)
    const d3 = gradient(d2, xs)

    // % acumulado
    let cr = 0, cm = 0
    const totR = real.reduce((a, b) => a + b, 0) || 1
    const totM = model.reduce((a, b) => a + b, 0) || 1
    const rows = xs.map((x, i) => {
      cr += real[i]; cm += model[i]
      return {
        x, freq: real[i], smooth: smooth[i], model: model[i],
        d1: d1[i], d2: d2[i], d3: d3[i],
        cumReal: (100 * cr) / totR, cumModel: (100 * cm) / totM,
        error: real[i] - model[i],
      }
    })

    const fit = linearFit(model, real)
    const maxAbsErr = Math.max(...rows.map(r => Math.abs(r.error)))
    const outOfBand = rows.filter(r => Math.abs(r.error) > ERROR_TARGET).length
    const p05 = rows.find(r => r.cumReal >= 5)?.x
    const p95 = rows.find(r => r.cumReal >= 95)?.x
    const maxReg = Math.max(...real, ...model) * 1.05 || 0.1

    // Ceros de las derivadas (solo donde la FDP tiene al menos 2 % de su máximo)
    const peak = Math.max(...smooth) || 1
    const keep = (i) => smooth[i] >= 0.02 * peak || smooth[i - 1] >= 0.02 * peak
    const interp = (arr, x) => {
      const j = xs.findIndex(v => v >= x)
      if (j <= 0) return arr[0]
      const t = (x - xs[j - 1]) / (xs[j] - xs[j - 1])
      return arr[j - 1] + t * (arr[j] - arr[j - 1])
    }
    const z1 = zeroCrossings(xs, d1, keep).map(z => ({ ...z, y: interp(smooth, z.x) }))
    const z2 = zeroCrossings(xs, d2, keep).map(z => ({ ...z, y: interp(d1, z.x) }))
    // Ceros de la 3ª derivada = máximos y mínimos de la 2ª derivada.
    // Un mínimo de la 2ª derivada (curvatura más negativa) marca el centro de un pico
    // o de un hombro. Si no hay un máximo de la FDP cerca, es un componente "escondido".
    const minD2 = Math.min(...d2)
    const z3all = zeroCrossings(xs, d3, keep)
      .map(z => ({ ...z, y: interp(d2, z.x) }))
      .filter(z => Math.abs(z.y) >= 0.05 * Math.abs(minD2))
    const NEAR = 4
    const hidden = z3all.filter(z => z.kind === 'min' && z.y < 0 &&
      !z1.some(m => m.kind === 'max' && Math.abs(m.x - z.x) <= NEAR))
    // Se muestran solo los cambios claros de curvatura (≥ 10 % del mayor valor de la
    // 2ª derivada en la zona con datos) y los hombros; los muy pequeños se omiten.
    const maxAbsD2 = Math.max(...d2.map((v, i) => (keep(i) ? Math.abs(v) : 0))) || 1
    const z3 = z3all.filter(z => Math.abs(z.y) >= 0.1 * maxAbsD2 || hidden.includes(z))

    // Tiempo de humectación: % de la masa con HR ≥ 80 %
    const wet = (arr, tot) => (100 * arr.reduce((acc, v, i) => acc + (xs[i] >= TOW_HR ? v : 0), 0)) / tot
    const towReal = wet(real, totR)
    const towModel = wet(model, totM)

    return { rows, fit, maxAbsErr, outOfBand, changes: signChanges(xs, d2), p05, p95, maxReg, z1, z2, z3, hidden, towReal, towModel }
  }, [fdp])

  if (!calc) return null
  const { rows, fit, maxAbsErr, outOfBand, changes, p05, p95, maxReg, z1, z2, z3, hidden, towReal, towModel } = calc
  const HID_COLOR = '#facc15'
  const kc = (z) => (z.kind === 'max' ? MAX_COLOR : MIN_COLOR)
  const marks = [
    ...z1.map(z => ({ x: z.x, color: kc(z), text: z.kind === 'max' ? 'Máx. FDP' : 'Mín. FDP' })),
    ...z2.map(z => ({ x: z.x, color: kc(z), text: z.kind === 'max' ? 'Pend. máx.' : 'Pend. mín.' })),
    ...z3.map(z => ({ x: z.x, color: kc(z), text: z.kind === 'max' ? 'Curv. máx.' : 'Curv. mín.' })),
    ...hidden.map(z => ({ x: z.x, color: HID_COLOR, text: 'Hombro' })),
  ]
  // Puntos de cada gráfico de derivada (lleno = cero de esa derivada; hueco = su máximo o mínimo)
  const m1 = marks.filter(m => /FDP|Pend/.test(m.text))
  const m2 = marks.filter(m => /Pend|Curv/.test(m.text))
  const m3 = marks.filter(m => /Curv|Hombro/.test(m.text))
  const dotLabel = (z) => ({ value: z.x.toFixed(1), position: z.kind === 'max' ? 'top' : 'bottom', fontSize: 8, fill: kc(z) })
  const Note = ({ children }) => <div style={{ fontSize: 10, color: '#8b94a6', margin: '0 0 8px 34px', lineHeight: 1.5 }}>{children}</div>
  const R = <span style={{ color: MAX_COLOR }}>rojo</span>
  const C = <span style={{ color: MIN_COLOR }}>celeste</span>
  const zLabel = (z) => `${z.kind === 'max' ? 'máx' : 'mín'} ${z.x.toFixed(1)}%`
  const regData = rows.map(r => ({ model: r.model, real: r.freq, x: r.x }))

  const tableRows = betas.map((b, i) => ({
    curva: i + 1,
    mode: b.mode, alpha: b.alpha, beta: b.beta,
    variance: b.variance, variance_hr: b.variance_hr,
    A: b.A, B: b.B, w: b.w,
    shape: b.beta < 1 ? 'saturación (β < 1)' : b.alpha > 1 && b.beta > 1 ? 'campana' : 'borde',
  }))

  const exportTable = () => downloadCsv('curvas_beta_HR.csv', [
    ['Curva', 'Moda (%)', 'Alfa', 'Beta', 'Varianza [0-1]', 'Varianza (%²)', 'A (%)', 'B (%)', 'p (peso)', 'Forma'],
    ...tableRows.map(r => [r.curva, r.mode, r.alpha, r.beta, r.variance, r.variance_hr, r.A, r.B, r.w, r.shape]),
  ])

  const exportFdp = () => downloadCsv('fdp_HR_validacion.csv', [
    ['HR (%)', 'Frecuencia real x100 (%)', 'Modelo x100 (%)', 'Error x100 (real-modelo)', 'Real suavizada x100', '1a derivada', '2a derivada', '3a derivada', '% acumulado real', '% acumulado modelo'],
    ...rows.map(r => [r.x, r.freq, r.model, r.error, r.smooth, r.d1, r.d2, r.d3, r.cumReal.toFixed(3), r.cumModel.toFixed(3)]),
  ])

  const btnStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 8,
    border: '1px solid #272d37', background: '#0f1217', color: '#8b94a6', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  }

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #272d37' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e7eaf0' }}>Validación del ajuste</div>
        <div style={{ display: 'flex', gap: 8 }} data-html2canvas-ignore>
          <button onClick={exportTable} style={btnStyle}><Download size={13} /> Tabla de curvas (CSV)</button>
          <button onClick={exportFdp} style={btnStyle}><Download size={13} /> FDP y derivadas (CSV)</button>
        </div>
      </div>

      {/* 1 y 2: Real vs modelo / error por bin */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <Title>Real vs modelo (frecuencia × 100, %) · real = {fit.a.toFixed(4)}·modelo {fit.b >= 0 ? '+' : '−'} {Math.abs(fit.b).toFixed(4)} · R² = {fit.r2?.toFixed(4) ?? '—'}</Title>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 8, right: 12, left: -6, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
              <XAxis type="number" dataKey="model" name="Modelo" domain={[0, maxReg]} tick={tick} tickFormatter={v => v.toFixed(1)} label={{ value: 'Valor modelo (%)', position: 'insideBottomRight', offset: -2, fontSize: 9, fill: '#5b6577' }} />
              <YAxis type="number" dataKey="real" name="Real" domain={[0, maxReg]} tick={tick} tickFormatter={v => v.toFixed(1)} />
              <ZAxis range={[16, 16]} />
              <Tooltip contentStyle={tipStyle} formatter={(v, n) => [typeof v === 'number' ? v.toFixed(3) : v, n]} labelFormatter={() => ''} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxReg, y: maxReg }]} stroke="#5b6577" strokeDasharray="4 3" />
              <ReferenceLine segment={[{ x: 0, y: fit.b }, { x: maxReg, y: fit.a * maxReg + fit.b }]} stroke="#22c55e" />
              <Scatter data={regData} fill="var(--accent)" fillOpacity={0.6} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: '#5b6577' }}>Línea gris punteada = pendiente 1 (ajuste perfecto) · verde = recta de regresión.</div>
        </div>

        <div style={{ minWidth: 0 }}>
          <Title>Error por bin (real − modelo, × 100) · máx |error| = {maxAbsErr.toFixed(3)} · fuera de ±0.1: {outOfBand} bins</Title>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 8, right: 12, left: -6, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
              <XAxis type="number" dataKey="x" name="HR" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
              <YAxis type="number" dataKey="error" name="Error" tick={tick} tickFormatter={v => v.toFixed(2)}
                domain={[d => Math.min(d, -ERROR_TARGET * 1.2), d => Math.max(d, ERROR_TARGET * 1.2)]} />
              <ZAxis range={[16, 16]} />
              <ReferenceArea y1={-ERROR_TARGET} y2={ERROR_TARGET} fill="#22c55e" fillOpacity={0.07} />
              <ReferenceLine y={ERROR_TARGET} stroke="#22c55e" strokeDasharray="4 3" />
              <ReferenceLine y={-ERROR_TARGET} stroke="#22c55e" strokeDasharray="4 3" />
              <ReferenceLine y={0} stroke="#5b6577" />
              <Tooltip contentStyle={tipStyle} formatter={(v, n) => [typeof v === 'number' ? (n === 'HR' ? `${v}%` : v.toFixed(3)) : v, n]} labelFormatter={() => ''} />
              <Scatter data={rows} fill="#f59e0b" fillOpacity={0.7} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: '#5b6577' }}>Banda verde = tolerancia ±0.1 por bin (equivale a ±1×10⁻³ sin multiplicar por 100).</div>
        </div>
      </div>

      {/* 3: FDP y derivadas */}
      <div style={{ marginTop: 20 }}>
        <Title>FDP de HR (frecuencia × 100, %) con su 1ª, 2ª y 3ª derivada · <span style={{ color: MAX_COLOR }}>● máximo</span> <span style={{ color: MIN_COLOR }}>● mínimo</span></Title>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={rows} syncId="hr-deriv" margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
            <YAxis tick={tick} tickFormatter={v => v.toFixed(1)} />
            <Tooltip content={<DerivTooltip fmt={v => Number(v).toFixed(3)} marks={marks} />} />
            {betas.map((b, i) => (
              <ReferenceLine key={i} x={b.mode} stroke={`${BETA_COLORS[i] ?? '#5b6577'}90`} strokeDasharray="4 2"
                label={{ value: `m${i + 1}`, fontSize: 9, fill: BETA_COLORS[i] ?? '#5b6577', position: 'insideTopRight' }} />
            ))}
            <Line dataKey="freq" name="FDP real" stroke={FREQ_COLOR} strokeWidth={1} strokeOpacity={0.5} dot={false} isAnimationActive={false} />
            <Line dataKey="smooth" name="FDP suavizada" stroke={SUM_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
            {z1.map((z, i) => (
              <ReferenceDot key={`z1-${i}`} x={z.x} y={z.y} r={4} fill={z.kind === 'max' ? MAX_COLOR : MIN_COLOR} stroke="none"
                label={{ value: zLabel(z), position: z.kind === 'max' ? 'top' : 'bottom', fontSize: 9, fill: z.kind === 'max' ? MAX_COLOR : MIN_COLOR }} />
            ))}
            {hidden.map((z, i) => (
              <ReferenceDot key={`hid-${i}`} x={z.x} y={interpRow(rows, z.x)} r={5} fill="none" stroke={HID_COLOR} strokeWidth={2}
                label={{ value: `hombro ${z.x.toFixed(1)}%`, position: 'top', fontSize: 9, fill: HID_COLOR }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={rows} syncId="hr-deriv" margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
            <YAxis tick={tick} tickFormatter={v => v.toExponential(0)} />
            <Tooltip content={<DerivTooltip fmt={v => Number(v).toExponential(3)} marks={m1} />} />
            <ReferenceLine y={0} stroke="#5b6577" />
            <Line dataKey="d1" name="1ª derivada" stroke="#a3e635" strokeWidth={1.6} dot={false} isAnimationActive={false} />
            {z1.map((z, i) => (
              <ReferenceDot key={`d1z-${i}`} x={z.x} y={0} r={4} fill={z.kind === 'max' ? MAX_COLOR : MIN_COLOR} stroke="none" label={dotLabel(z)} />
            ))}
            {z2.map((z, i) => (
              <ReferenceDot key={`d1e-${i}`} x={z.x} y={z.y} r={3} fill="none" stroke={z.kind === 'max' ? MAX_COLOR : MIN_COLOR} strokeWidth={1.5} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <Note><b>1ª derivada</b> · ● punto lleno = pico ({R}) o valle ({C}) de la FDP · ○ círculo hueco = pendiente máxima o mínima (se ve como punto lleno en la 2ª derivada).</Note>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={rows} syncId="hr-deriv" margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
            <YAxis tick={tick} tickFormatter={v => v.toExponential(0)} />
            <Tooltip content={<DerivTooltip fmt={v => Number(v).toExponential(3)} marks={m2} />} />
            <ReferenceLine y={0} stroke="#5b6577" />
            <Line dataKey="d2" name="2ª derivada" stroke="#f472b6" strokeWidth={1.6} dot={false} isAnimationActive={false} />
            {z2.map((z, i) => (
              <ReferenceDot key={`d2z-${i}`} x={z.x} y={0} r={4} fill={z.kind === 'max' ? MAX_COLOR : MIN_COLOR} stroke="none" label={dotLabel(z)} />
            ))}
            {z3.map((z, i) => (
              <ReferenceDot key={`d2e-${i}`} x={z.x} y={z.y} r={3} fill="none" stroke={z.kind === 'max' ? MAX_COLOR : MIN_COLOR} strokeWidth={1.5} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <Note><b>2ª derivada</b> · ● punto lleno = pendiente máxima ({R}) o mínima ({C}) de la FDP (inflexión) · ○ círculo hueco = curvatura máxima o mínima (se ve como punto lleno en la 3ª derivada).</Note>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={rows} syncId="hr-deriv" margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
            <YAxis tick={tick} tickFormatter={v => v.toExponential(0)} />
            <Tooltip content={<DerivTooltip fmt={v => Number(v).toExponential(3)} marks={m3} />} />
            <ReferenceLine y={0} stroke="#5b6577" />
            {hidden.map((z, i) => (
              <ReferenceLine key={`hl-${i}`} x={z.x} stroke={HID_COLOR} strokeDasharray="3 3" />
            ))}
            <Line dataKey="d3" name="3ª derivada" stroke="#2dd4bf" strokeWidth={1.6} dot={false} isAnimationActive={false} />
            {z3.map((z, i) => (
              <ReferenceDot key={`d3z-${i}`} x={z.x} y={0} r={4} fill={z.kind === 'max' ? MAX_COLOR : MIN_COLOR} stroke="none" label={dotLabel(z)} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <Note><b>3ª derivada</b> · ● punto lleno = curvatura máxima ({R}) o mínima ({C}) de la FDP · línea amarilla = hombro (posible curva escondida).</Note>
        <div style={{ fontSize: 11, color: '#8b94a6', marginTop: 4, lineHeight: 1.6 }}>
          <b style={{ color: '#e7eaf0' }}>Ceros de la 1ª derivada</b> (máximos y mínimos de la FDP):{' '}
          <span style={{ color: MAX_COLOR }}>máximos {z1.filter(z => z.kind === 'max').map(z => z.x.toFixed(1)).join(', ') || '—'} %</span>
          {' · '}<span style={{ color: MIN_COLOR }}>mínimos {z1.filter(z => z.kind === 'min').map(z => z.x.toFixed(1)).join(', ') || '—'} %</span>
          <br />
          <b style={{ color: '#e7eaf0' }}>Ceros de la 2ª derivada</b> (máximos y mínimos de la 1ª derivada, inflexiones de la FDP):{' '}
          <span style={{ color: MAX_COLOR }}>máximos {z2.filter(z => z.kind === 'max').map(z => z.x.toFixed(1)).join(', ') || '—'} %</span>
          {' · '}<span style={{ color: MIN_COLOR }}>mínimos {z2.filter(z => z.kind === 'min').map(z => z.x.toFixed(1)).join(', ') || '—'} %</span>
          <br />
          <b style={{ color: '#e7eaf0' }}>Ceros de la 3ª derivada</b> (máximos y mínimos de la 2ª derivada; se omiten los cambios muy pequeños):{' '}
          <span style={{ color: MAX_COLOR }}>máximos {z3.filter(z => z.kind === 'max').map(z => z.x.toFixed(1)).join(', ') || '—'} %</span>
          {' · '}<span style={{ color: MIN_COLOR }}>mínimos {z3.filter(z => z.kind === 'min').map(z => z.x.toFixed(1)).join(', ') || '—'} %</span>
          <br />
          <b style={{ color: HID_COLOR }}>Posibles componentes escondidos</b> (mínimo de la 2ª derivada sin un pico de la FDP a menos de {4} %):{' '}
          {hidden.length ? hidden.map(z => `${z.x.toFixed(1)} %`).join(', ') : 'ninguno'}
          <br />
          Cambios de signo de la 2ª derivada · <span style={{ color: '#a78bfa' }}>de más a menos</span>:{' '}
          {changes.filter(c => c.kind === 'down').map(c => c.x.toFixed(0)).join(', ') || '—'} %
          {' · '}<span style={{ color: '#f97316' }}>de menos a más</span> (valles, límites A/B):{' '}
          {changes.filter(c => c.kind === 'up').map(c => c.x.toFixed(0)).join(', ') || '—'} %
        </div>
      </div>

      {/* 4: Acumulado */}
      <div style={{ marginTop: 20 }}>
        <Title>% acumulado de datos vs HR · 5 % de los datos por debajo de {p05 ?? '—'} % HR · 95 % por debajo de {p95 ?? '—'} % HR · línea azul = umbral de humectación ({TOW_HR} %)</Title>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={rows} margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
            <YAxis tick={tick} domain={[0, 100]} unit="%" />
            <Tooltip contentStyle={tipStyle} labelFormatter={v => `HR ${v}%`} formatter={(v, n) => [`${Number(v).toFixed(2)}%`, n]} />
            <ReferenceLine y={5} stroke="#5b6577" strokeDasharray="4 3" />
            <ReferenceLine y={95} stroke="#5b6577" strokeDasharray="4 3" />
            <ReferenceLine x={TOW_HR} stroke={MIN_COLOR} strokeDasharray="4 3" />
            <Line dataKey="cumReal" name="Real" stroke={FREQ_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="cumModel" name="Modelo" stroke={SUM_COLOR} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 6: Tiempo de humectación */}
      <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {[['TOW datos', towReal, 'horas reales con HR ≥ 80 %'], ['TOW modelo', towModel, 'masa de la FDP ajustada ≥ 80 %'], ['Diferencia', towReal - towModel, 'datos − modelo (puntos)']].map(([label, v, sub]) => (
          <div key={label} style={{ background: '#0f1217', border: '1px solid #272d37', borderRadius: 8, padding: '10px 14px', minWidth: 150 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: label === 'Diferencia' ? '#e7eaf0' : MIN_COLOR }}>
              {label === 'Diferencia' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}` : `${v.toFixed(1)} %`}
            </div>
            <div style={{ fontSize: 11, color: '#e7eaf0', fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 10, color: '#5b6577' }}>{sub}</div>
          </div>
        ))}
        <div style={{ flex: 1, minWidth: 220, fontSize: 11, color: '#8b94a6', alignSelf: 'center', lineHeight: 1.5 }}>
          Tiempo de humectación (TOW): fracción de las horas con HR ≥ {TOW_HR} %. Que datos y modelo coincidan es otra prueba del ajuste en la zona húmeda.
        </div>
      </div>

      {/* 5: Tabla por curva */}
      <div style={{ marginTop: 20, overflowX: 'auto' }}>
        <Title>Parámetros de cada curva Beta</Title>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#e7eaf0' }}>
          <thead>
            <tr style={{ color: '#8b94a6' }}>
              {['Curva', 'Moda', 'α', 'β', 'Var [0-1]', 'Var (%²)', 'A', 'B', 'p', 'Forma'].map((h, i) => (
                <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #272d37', textAlign: i === 0 || i === 9 ? 'left' : 'right', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r, i) => (
              <tr key={r.curva} style={{ textAlign: 'right' }}>
                <td style={{ padding: '6px 8px', textAlign: 'left' }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: BETA_COLORS[i] ?? '#5b6577', marginRight: 6 }} />
                  Beta {r.curva}
                </td>
                <td style={{ padding: '6px 8px' }}>{r.mode?.toFixed(1)}%</td>
                <td style={{ padding: '6px 8px' }}>{r.alpha?.toFixed(3)}</td>
                <td style={{ padding: '6px 8px' }}>{r.beta?.toFixed(3)}</td>
                <td style={{ padding: '6px 8px' }}>{r.variance?.toFixed(4)}</td>
                <td style={{ padding: '6px 8px' }}>{r.variance_hr?.toFixed(2)}</td>
                <td style={{ padding: '6px 8px' }}>{r.A?.toFixed(1)}</td>
                <td style={{ padding: '6px 8px' }}>{r.B?.toFixed(1)}</td>
                <td style={{ padding: '6px 8px' }}>{r.w?.toFixed(3)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'left', color: '#8b94a6' }}>{r.shape}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
