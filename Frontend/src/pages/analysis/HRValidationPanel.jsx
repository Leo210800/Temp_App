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
//
// Todo se calcula en el navegador a partir de la FDP que ya devuelve
// /measurements/stats; no hay llamadas nuevas al backend.
// ─────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import {
  LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts'
import { Download } from 'lucide-react'

const BETA_COLORS = ['#8b94a6', '#eab308', '#38bdf8', '#4ade80', '#c084fc']
const FREQ_COLOR = '#ef4444'
const SUM_COLOR = '#e2e8f0'
const ERROR_TARGET = 1e-3          // criterio de error máximo por bin
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

const fmtE = (v, d = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toExponential(d))

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
    const real = fdp.map(p => p.freq ?? 0)
    const model = fdp.map(p => p.model ?? 0)

    // Derivadas como en _fit_beta_components
    const sigma = Math.max(1.5, xs.length / 60)
    const smooth = gaussianFilter1d(real, sigma)
    const d1 = gradient(smooth, xs)
    const d2 = gradient(d1, xs)

    // % acumulado
    let cr = 0, cm = 0
    const totR = real.reduce((a, b) => a + b, 0) || 1
    const totM = model.reduce((a, b) => a + b, 0) || 1
    const rows = xs.map((x, i) => {
      cr += real[i]; cm += model[i]
      return {
        x, freq: real[i], smooth: smooth[i], model: model[i],
        d1: d1[i], d2: d2[i],
        cumReal: (100 * cr) / totR, cumModel: (100 * cm) / totM,
        error: real[i] - model[i],
      }
    })

    const fit = linearFit(model, real)
    const maxAbsErr = Math.max(...rows.map(r => Math.abs(r.error)))
    const outOfBand = rows.filter(r => Math.abs(r.error) > ERROR_TARGET).length
    const p05 = rows.find(r => r.cumReal >= 5)?.x
    const p95 = rows.find(r => r.cumReal >= 95)?.x
    const maxReg = Math.max(...real, ...model) * 1.05 || 0.001

    return { rows, fit, maxAbsErr, outOfBand, changes: signChanges(xs, d2), p05, p95, maxReg }
  }, [fdp])

  if (!calc) return null
  const { rows, fit, maxAbsErr, outOfBand, changes, p05, p95, maxReg } = calc
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
    ['HR (%)', 'Frecuencia real', 'Modelo', 'Error (real-modelo)', 'Real suavizada', '1a derivada', '2a derivada', '% acumulado real', '% acumulado modelo'],
    ...rows.map(r => [r.x, r.freq, r.model, r.error, r.smooth, r.d1, r.d2, r.cumReal.toFixed(3), r.cumModel.toFixed(3)]),
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
          <Title>Real vs modelo · real = {fit.a.toFixed(4)}·modelo {fit.b >= 0 ? '+' : '−'} {fmtE(Math.abs(fit.b))} · R² = {fit.r2?.toFixed(4) ?? '—'}</Title>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 8, right: 12, left: -6, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
              <XAxis type="number" dataKey="model" name="Modelo" domain={[0, maxReg]} tick={tick} tickFormatter={v => v.toFixed(3)} label={{ value: 'Valor modelo', position: 'insideBottomRight', offset: -2, fontSize: 9, fill: '#5b6577' }} />
              <YAxis type="number" dataKey="real" name="Real" domain={[0, maxReg]} tick={tick} tickFormatter={v => v.toFixed(3)} />
              <ZAxis range={[16, 16]} />
              <Tooltip contentStyle={tipStyle} formatter={(v, n) => [typeof v === 'number' ? v.toFixed(5) : v, n]} labelFormatter={() => ''} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxReg, y: maxReg }]} stroke="#5b6577" strokeDasharray="4 3" />
              <ReferenceLine segment={[{ x: 0, y: fit.b }, { x: maxReg, y: fit.a * maxReg + fit.b }]} stroke="#22c55e" />
              <Scatter data={regData} fill="var(--accent)" fillOpacity={0.6} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: '#5b6577' }}>Línea gris punteada = pendiente 1 (ajuste perfecto) · verde = recta de regresión.</div>
        </div>

        <div style={{ minWidth: 0 }}>
          <Title>Error por bin (real − modelo) · máx |error| = {fmtE(maxAbsErr)} · fuera de ±1×10⁻³: {outOfBand} bins</Title>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 8, right: 12, left: -6, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
              <XAxis type="number" dataKey="x" name="HR" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
              <YAxis type="number" dataKey="error" name="Error" tick={tick} tickFormatter={v => v.toExponential(0)}
                domain={[d => Math.min(d, -ERROR_TARGET * 1.2), d => Math.max(d, ERROR_TARGET * 1.2)]} />
              <ZAxis range={[16, 16]} />
              <ReferenceArea y1={-ERROR_TARGET} y2={ERROR_TARGET} fill="#22c55e" fillOpacity={0.07} />
              <ReferenceLine y={ERROR_TARGET} stroke="#22c55e" strokeDasharray="4 3" />
              <ReferenceLine y={-ERROR_TARGET} stroke="#22c55e" strokeDasharray="4 3" />
              <ReferenceLine y={0} stroke="#5b6577" />
              <Tooltip contentStyle={tipStyle} formatter={(v, n) => [typeof v === 'number' ? (n === 'HR' ? `${v}%` : v.toExponential(2)) : v, n]} labelFormatter={() => ''} />
              <Scatter data={rows} fill="#f59e0b" fillOpacity={0.7} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: '#5b6577' }}>Banda verde = tolerancia ±1×10⁻³ por bin.</div>
        </div>
      </div>

      {/* 3: FDP y derivadas */}
      <div style={{ marginTop: 20 }}>
        <Title>FDP de HR con su 1ª y 2ª derivada (curva suavizada, igual que el algoritmo de ajuste)</Title>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={rows} syncId="hr-deriv" margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
            <YAxis tick={tick} tickFormatter={v => v.toFixed(3)} />
            <Tooltip contentStyle={tipStyle} labelFormatter={v => `HR ${v}%`} formatter={(v, n) => [Number(v).toExponential(3), n]} />
            {betas.map((b, i) => (
              <ReferenceLine key={i} x={b.mode} stroke={`${BETA_COLORS[i] ?? '#5b6577'}90`} strokeDasharray="4 2"
                label={{ value: `m${i + 1}`, fontSize: 9, fill: BETA_COLORS[i] ?? '#5b6577', position: 'insideTopRight' }} />
            ))}
            <Line dataKey="freq" name="FDP real" stroke={FREQ_COLOR} strokeWidth={1} strokeOpacity={0.5} dot={false} isAnimationActive={false} />
            <Line dataKey="smooth" name="FDP suavizada" stroke={SUM_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={rows} syncId="hr-deriv" margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
            <YAxis tick={tick} tickFormatter={v => v.toExponential(0)} />
            <Tooltip contentStyle={tipStyle} labelFormatter={v => `HR ${v}%`} formatter={(v, n) => [Number(v).toExponential(3), n]} />
            <ReferenceLine y={0} stroke="#5b6577" />
            <Line dataKey="d1" name="1ª derivada" stroke="#38bdf8" strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={rows} syncId="hr-deriv" margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
            <YAxis tick={tick} tickFormatter={v => v.toExponential(0)} />
            <Tooltip contentStyle={tipStyle} labelFormatter={v => `HR ${v}%`} formatter={(v, n) => [Number(v).toExponential(3), n]} />
            <ReferenceLine y={0} stroke="#5b6577" />
            {changes.map((c, i) => (
              <ReferenceLine key={i} x={c.x} stroke={c.kind === 'up' ? '#f97316' : '#a78bfa'} strokeDasharray="2 3" />
            ))}
            <Line dataKey="d2" name="2ª derivada" stroke="#f472b6" strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11, color: '#8b94a6', marginTop: 4, lineHeight: 1.6 }}>
          Cambios de signo de la 2ª derivada · <span style={{ color: '#a78bfa' }}>de más a menos</span>:{' '}
          {changes.filter(c => c.kind === 'down').map(c => c.x.toFixed(0)).join(', ') || '—'} %
          {' · '}<span style={{ color: '#f97316' }}>de menos a más</span> (valles, límites A/B):{' '}
          {changes.filter(c => c.kind === 'up').map(c => c.x.toFixed(0)).join(', ') || '—'} %
        </div>
      </div>

      {/* 4: Acumulado */}
      <div style={{ marginTop: 20 }}>
        <Title>% acumulado de datos vs HR · 5 % de los datos por debajo de {p05 ?? '—'} % HR · 95 % por debajo de {p95 ?? '—'} % HR</Title>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={rows} margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={tick} unit="%" />
            <YAxis tick={tick} domain={[0, 100]} unit="%" />
            <Tooltip contentStyle={tipStyle} labelFormatter={v => `HR ${v}%`} formatter={(v, n) => [`${Number(v).toFixed(2)}%`, n]} />
            <ReferenceLine y={5} stroke="#5b6577" strokeDasharray="4 3" />
            <ReferenceLine y={95} stroke="#5b6577" strokeDasharray="4 3" />
            <Line dataKey="cumReal" name="Real" stroke={FREQ_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="cumModel" name="Modelo" stroke={SUM_COLOR} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
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
