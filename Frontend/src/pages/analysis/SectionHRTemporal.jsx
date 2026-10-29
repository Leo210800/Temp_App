// ─────────────────────────────────────────────────────────────
// b.3) HR temporal — Análisis de tiempo de la FDP de Humedad Relativa
//
// Responde la sección "Análisis de tiempo" del artículo: en qué horas del día
// y en qué meses aparece cada curva Beta. Incluye:
//   1. FDP por periodo del día (cuartos de 6 h) con ajuste Beta bajo pedido
//   2. Curvas de densidad por hora y por mes
//   3. Presencia de cada curva Beta en mes × hora + curva dominante
//
// Backend: GET /measurements/hr-temporal y /measurements/hr-temporal/period-fit
// (solo lectura, no escribe en la base).
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo } from 'react'
import * as d3 from 'd3'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Loader2, AlertTriangle, Play } from 'lucide-react'
import { measurementsApi } from '../../services/api'

const SPIN = { animation: 'spin 0.8s linear infinite' }
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
// Mismos colores que la pantalla de FDP (Beta 1..5)
const BETA_COLORS = ['#8b94a6', '#eab308', '#38bdf8', '#4ade80', '#c084fc']
const FREQ_COLOR = '#ef4444'
const SUM_COLOR = '#e2e8f0'
const X_TICKS = [0, 25, 50, 75, 100]
// Una curva con peso < 1 % la descartó el optimizador (queda en su peso mínimo):
// suele pegarse a 1 o 2 mediciones sueltas en la cola baja de HR.
const W_MIN = 0.01

const hourColor  = (h) => d3.interpolateSinebow(h / 24)
const monthColor = (m) => d3.interpolateTurbo(0.08 + 0.84 * ((m - 1) / 11))

// Escala por clases con colores bien distintos (como el mapa de curva dominante):
// 5 clases de igual ancho, cada una con su propio color, para leerlo de un vistazo.
const LEVELS = 5
const EMPTY_CELL = '#161a21'
const CLASS_COLORS = ['#475569', '#38bdf8', '#4ade80', '#facc15', '#ef4444']
const CLASS_NAMES = ['Muy poca', 'Poca', 'Media', 'Alta', 'Muy alta']
const stepColor = (_base, t) => {
  if (t == null || !(t > 0)) return EMPTY_CELL
  return CLASS_COLORS[Math.min(LEVELS, Math.ceil(t * LEVELS)) - 1]
}
const textOn = (bg) => (d3.hsl(bg).l > 0.55 ? '#0b0d10' : '#e7eaf0')

function StepLegend({ base, max, unit = '%', decimals = 0 }) {
  const fmt = (v) => `${v.toFixed(decimals)}${unit}`
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, fontSize: 10, color: '#8b94a6' }}>
      {Array.from({ length: LEVELS }, (_, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: stepColor(base, (i + 1) / LEVELS) }} />
          <b style={{ color: '#c7cdd8', fontWeight: 600 }}>{CLASS_NAMES[i]}</b> {fmt((max * i) / LEVELS)}–{fmt((max * (i + 1)) / LEVELS)}
        </span>
      ))}
    </div>
  )
}

// ── UI básicos (mismo estilo que Analysis.jsx) ──────────────────
const Card = ({ title, subtitle, right, children }) => (
  <div style={{ background: '#161a21', border: '1px solid #272d37', borderRadius: 12, padding: 20, marginBottom: 20 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#e7eaf0' }}>{title}</h3>
        {subtitle && <div style={{ marginTop: 4, fontSize: 12, color: '#8b94a6' }}>{subtitle}</div>}
      </div>
      {right}
    </div>
    {children}
  </div>
)

const Spinner = ({ text = 'Cargando datos…' }) => (
  <div style={{ padding: '3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#8b94a6', fontSize: 14 }}>
    <Loader2 size={16} style={SPIN} /> {text}
  </div>
)

const Err = ({ msg }) => (
  <div style={{ padding: '12px 16px', background: '#ef444420', border: '1px solid #ef444440', borderRadius: 8, color: '#ef4444', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
    <AlertTriangle size={16} style={{ flexShrink: 0 }} /> {msg}
  </div>
)

const Stat = ({ label, value, color }) => (
  <div style={{ background: '#0f1217', borderRadius: 8, padding: '10px 14px', textAlign: 'center', minWidth: 90 }}>
    <div style={{ fontSize: 16, fontWeight: 700, color: color || '#e7eaf0' }}>{value}</div>
    <div style={{ fontSize: 10, color: '#5b6577', marginTop: 2 }}>{label}</div>
  </div>
)

const btn = (disabled) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  background: disabled ? '#272d37' : 'var(--accent)',
  color: disabled ? '#5b6577' : 'var(--accent-fg)',
})

const fmtPct = (v, d = 1) => (v == null ? '—' : `${Number(v).toFixed(d)}%`)
const fmtExp = (v) => (v == null ? '—' : Number(v).toExponential(2))
const axisTick = { fontSize: 10, fill: '#8b94a6' }

// ─────────────────────────────────────────────────────────────
// 1. Panel de un periodo del día
// ─────────────────────────────────────────────────────────────
function PeriodPanel({ period, fit, fitting, fitError }) {
  // Datos: curva empírica en rejilla 0..100; si hay ajuste, se le suman las Betas
  const data = useMemo(() => {
    const byX = new Map((fit?.fdp ?? []).map(p => [Math.round(p.x), p]))
    return period.curve.map(p => {
      const row = { x: p.x, freq: p.freq }
      const f = byX.get(p.x)
      if (f) {
        row.model = f.model
        ;(fit.betas ?? []).forEach((_, i) => { row[`beta${i + 1}`] = f[`beta${i + 1}`] })
      }
      return row
    })
  }, [period, fit])

  return (
    <div style={{ background: '#0f1217', border: '1px solid #272d37', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e7eaf0' }}>{period.label}</div>
        <div style={{ fontSize: 11, color: '#8b94a6' }}>
          N = {period.n.toLocaleString()} · moda {period.mode ?? '—'}% · saturada {fmtPct(period.saturated_pct)} · TOW {fmtPct(period.tow_pct)}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
          <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={axisTick} unit="%" />
          <YAxis tick={axisTick} tickFormatter={v => v.toFixed(2)} />
          <Tooltip
            contentStyle={{ background: '#161a21', border: '1px solid #272d37', fontSize: 11 }}
            labelFormatter={v => `HR ${v}%`}
            formatter={(v, name) => [Number(v).toFixed(5), name]}
          />
          <Line dataKey="freq" name="Frecuencia" stroke={FREQ_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          {(fit?.betas ?? []).map((b, i) => (b.w >= W_MIN &&
            <Line key={i} dataKey={`beta${i + 1}`} name={`Beta ${i + 1}`} stroke={BETA_COLORS[i]} strokeWidth={1.2} dot={false} isAnimationActive={false} />
          ))}
          {fit && <Line dataKey="model" name="Beta suma" stroke={SUM_COLOR} strokeWidth={2.5} dot={false} isAnimationActive={false} />}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, color: '#8b94a6', marginTop: 4, minHeight: 16 }}>
        {fitting && <span><Loader2 size={11} style={SPIN} /> Ajustando Betas…</span>}
        {fitError && <span style={{ color: '#ef4444' }}>{fitError}</span>}
        {fit && !fitting && (
          <span>
            R² = {fit.r2?.toFixed(4) ?? '—'} · EMC = {fmtExp(fit.mse)} · TOW modelo {fmtPct(fit.tow_model_pct)} · {fit.betas.filter(b => b.w >= W_MIN).length} curvas · modas:{' '}
            {fit.betas.map((b, i) => (b.w >= W_MIN &&
              <span key={i} style={{ color: BETA_COLORS[i], marginRight: 6 }}>{b.mode?.toFixed(0)}%</span>
            ))}
            {fit.betas.some(b => b.w < W_MIN) && (
              <span title="El optimizador dejó estas curvas en su peso mínimo: se pegan a mediciones sueltas y no aportan al ajuste."
                style={{ color: '#5b6577' }}>
                {' '}· descartadas (peso &lt; 1 %): {fit.betas.filter(b => b.w < W_MIN).map(b => `${b.mode?.toFixed(0)}%`).join(', ')}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 2. Curvas superpuestas (por hora o por mes)
// ─────────────────────────────────────────────────────────────
function OverlayCurves({ groups, keyName, colorOf, labelOf }) {
  const [hidden, setHidden] = useState(() => new Set())
  const data = useMemo(() => {
    if (!groups?.length) return []
    return groups[0].curve.map((p, j) => {
      const row = { x: p.x }
      groups.forEach(g => { row[`g${g[keyName]}`] = g.curve[j]?.smooth ?? 0 })
      return row
    })
  }, [groups, keyName])

  const toggle = (k) => setHidden(prev => {
    const next = new Set(prev)
    next.has(k) ? next.delete(k) : next.add(k)
    return next
  })

  return (
    <>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
          <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={X_TICKS} tick={axisTick} unit="%" />
          <YAxis tick={axisTick} tickFormatter={v => v.toFixed(2)} />
          <Tooltip
            contentStyle={{ background: '#161a21', border: '1px solid #272d37', fontSize: 11 }}
            labelFormatter={v => `HR ${v}%`}
            formatter={(v, name) => [Number(v).toFixed(4), name]}
          />
          {groups.map(g => {
            const k = g[keyName]
            return hidden.has(k) ? null : (
              <Line key={k} dataKey={`g${k}`} name={labelOf(k)} stroke={colorOf(k)} strokeWidth={1.4} dot={false} isAnimationActive={false} />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {groups.map(g => {
          const k = g[keyName]
          const off = hidden.has(k)
          return (
            <button key={k} onClick={() => toggle(k)} title={`moda ${g.mode ?? '—'}% · N ${g.n.toLocaleString()}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 6,
                border: '1px solid #272d37', background: off ? 'transparent' : '#0f1217',
                color: off ? '#5b6577' : '#e7eaf0', fontSize: 11, cursor: 'pointer',
              }}>
              <span style={{ width: 10, height: 3, borderRadius: 2, background: off ? '#272d37' : colorOf(k) }} />
              {labelOf(k)}
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: 11, color: '#5b6577', marginTop: 6 }}>Clic en una etiqueta para ocultar o mostrar su curva.</div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// 3. Mapa mes × hora (presencia de una curva o curva dominante)
// ─────────────────────────────────────────────────────────────
function MonthHourGrid({ cellColor, cellTitle, cellSize = 14 }) {
  return (
    <div style={{ maxWidth: cellSize * 24 + 60 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '28px repeat(24, minmax(0, 1fr))', gap: 1, fontSize: 9, color: '#8b94a6' }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ textAlign: 'center' }}>{h % 6 === 0 ? h : ''}</div>
        ))}
        {MONTHS.map((m, mi) => (
          <Row key={m} label={m} mi={mi} cellColor={cellColor} cellTitle={cellTitle} cellSize={cellSize} />
        ))}
      </div>
    </div>
  )
}

const Row = ({ label, mi, cellColor, cellTitle, cellSize }) => (
  <>
    <div style={{ display: 'flex', alignItems: 'center' }}>{label}</div>
    {Array.from({ length: 24 }, (_, h) => (
      <div key={h} title={cellTitle(mi, h)} style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 2, background: cellColor(mi, h) }} />
    ))}
  </>
)

function ComponentTimeCard({ comp, color }) {
  const max = d3.max(comp.share_matrix.flat()) || 1
  return (
    <div style={{ background: '#0f1217', border: '1px solid #272d37', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: color }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e7eaf0' }}>Beta {comp.index}</span>
        <span style={{ fontSize: 11, color: '#8b94a6' }}>moda {comp.mode?.toFixed(1)}% · peso {(comp.w * 100).toFixed(1)}%</span>
      </div>
      <MonthHourGrid
        cellSize={14}
        cellColor={(mi, h) => {
          const v = comp.share_matrix[mi]?.[h] ?? 0
          return stepColor(color, v / max)
        }}
        cellTitle={(mi, h) => `${MONTHS[mi]} ${String(h).padStart(2, '0')}:00 → ${((comp.share_matrix[mi]?.[h] ?? 0) * 100).toFixed(1)}% de las mediciones`}
      />
      <StepLegend base={color} max={max * 100} decimals={max * 100 < 10 ? 1 : 0} />
      <div style={{ fontSize: 11, color: '#8b94a6', marginTop: 8, lineHeight: 1.6 }}>
        Seca {fmtPct(comp.pct_dry)} · lluviosa {fmtPct(comp.pct_rainy)}<br />
        Día {fmtPct(comp.pct_day)} · noche {fmtPct(comp.pct_night)}<br />
        Más presente en {MONTHS[comp.peak_month - 1]}, hacia las {String(comp.peak_hour).padStart(2, '0')}:00
      </div>
    </div>
  )
}

function TimeProfiles({ components, field, labels, xLabel }) {
  const data = labels.map((lab, j) => {
    const row = { x: lab }
    components.forEach(c => { row[`b${c.index}`] = c[field][j] })
    return row
  })
  return (
    <div>
      <div style={{ fontSize: 12, color: '#8b94a6', fontWeight: 600, marginBottom: 6 }}>{xLabel}</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
          <XAxis dataKey="x" tick={axisTick} interval={0} />
          <YAxis tick={axisTick} unit="%" />
          <Tooltip contentStyle={{ background: '#161a21', border: '1px solid #272d37', fontSize: 11 }} formatter={(v, n) => [`${Number(v).toFixed(1)}%`, n]} />
          {components.map((c, i) => (
            <Line key={c.index} dataKey={`b${c.index}`} name={`Beta ${c.index}`} stroke={BETA_COLORS[i]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sección principal
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Tiempo de humectación: por periodo, por mes y mapa mes × hora
// ─────────────────────────────────────────────────────────────
const TOW_COLOR = '#38bdf8'
const towBg = (v) => (v == null ? EMPTY_CELL : v <= 0 ? '#1b2029' : stepColor(TOW_COLOR, Math.min(1, v / 100)))

function TowCells({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 4 }}>
      {items.map(it => (
        <div key={it.label} title={`${it.label}: ${fmtPct(it.value)} de las horas con HR ≥ 80 %`}
          style={{ background: towBg(it.value), borderRadius: 6, padding: '6px 2px', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: textOn(towBg(it.value)) }}>{it.value == null ? '—' : it.value.toFixed(0)}</div>
          <div style={{ fontSize: 10, color: textOn(towBg(it.value)), opacity: 0.8 }}>{it.label}</div>
        </div>
      ))}
    </div>
  )
}

function TowSummary({ data }) {
  const periods = data.periods.map(p => ({ label: p.label.split(' ')[0], value: p.tow_pct }))
  const months = data.months.map(m => ({ label: MONTHS[m.month - 1], value: m.tow_pct }))
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: '#8b94a6', marginBottom: 6, fontWeight: 600 }}>Por periodo del día (% de horas)</div>
        <TowCells items={periods} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#8b94a6', marginBottom: 6, fontWeight: 600 }}>Por mes (% de horas)</div>
        <TowCells items={months} />
        <StepLegend base={TOW_COLOR} max={100} />
      </div>
      {data.tow_matrix && (
        <div style={{ maxWidth: 520 }}>
          <div style={{ fontSize: 12, color: '#8b94a6', marginBottom: 6, fontWeight: 600 }}>Mes × hora (% de horas húmedas, colores según la leyenda)</div>
          <MonthHourGrid
            cellSize={14}
            cellColor={(mi, h) => towBg(data.tow_matrix[mi]?.[h])}
            cellTitle={(mi, h) => `${MONTHS[mi]} ${String(h).padStart(2, '0')}:00 → ${fmtPct(data.tow_matrix[mi]?.[h])} de las horas con HR ≥ 80 %`}
          />
          <StepLegend base={TOW_COLOR} max={100} />
        </div>
      )}
      <div style={{ fontSize: 11, color: '#8b94a6' }}>
        El TOW se usa para estimar la corrosión atmosférica. La norma ISO 9223 además exige temperatura mayor a 0 °C; aquí se cuenta solo la humedad, según lo acordado.
      </div>
    </div>
  )
}

export default function SectionHRTemporal({ stationId, dateFrom, dateTo }) {
  const [excludeSat, setExcludeSat] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [fits, setFits] = useState({})          // period key → resultado
  const [fitting, setFitting] = useState(null)  // period key en curso
  const [fitErrors, setFitErrors] = useState({})

  const load = useCallback(async () => {
    if (!stationId) return
    setLoading(true); setError(null); setFits({}); setFitErrors({})
    try {
      const res = await measurementsApi.hrTemporal({
        station_id: stationId, date_from: dateFrom, date_to: dateTo, exclude_saturated: excludeSat,
      })
      setData(res)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [stationId, dateFrom, dateTo, excludeSat])

  useEffect(() => { load() }, [load])

  // Los ajustes por periodo se piden uno a uno: cada uno tarda ~15-20 s.
  const fitAll = async () => {
    if (!data || fitting) return
    for (const p of data.periods) {
      setFitting(p.key)
      try {
        const res = await measurementsApi.hrPeriodFit({
          station_id: stationId, period: p.key, date_from: dateFrom, date_to: dateTo, exclude_saturated: excludeSat,
        })
        if (res.ok) setFits(prev => ({ ...prev, [p.key]: res }))
        else setFitErrors(prev => ({ ...prev, [p.key]: res.msg }))
      } catch (e) {
        setFitErrors(prev => ({ ...prev, [p.key]: e.message }))
      }
    }
    setFitting(null)
  }

  const ta = data?.time_analysis
  const nFits = Object.keys(fits).length

  return (
    <div>
      {/* Controles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e7eaf0', cursor: 'pointer' }}>
          <input type="checkbox" checked={excludeSat} onChange={e => setExcludeSat(e.target.checked)} disabled={loading || !!fitting} />
          HR no saturada (excluir HR = 100 % de las curvas por periodo, hora y mes)
        </label>
      </div>

      {error && <Err msg={error} />}
      {loading && <Spinner text="Calculando curvas por periodo, hora y mes…" />}

      {!loading && data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <Stat label="Mediciones HR" value={data.n.toLocaleString()} />
            <Stat label="Saturadas (HR = 100 %)" value={fmtPct(data.saturated_pct, 2)} color="#c084fc" />
            <Stat label="TOW datos (HR ≥ 80 %)" value={fmtPct(data.tow_pct, 1)} color="#38bdf8" />
            <Stat label="TOW modelo (FDP ≥ 80 %)" value={fmtPct(data.tow_model_pct, 1)} color="#38bdf8" />
            <Stat label="R² ajuste global" value={data.global_fit?.r2?.toFixed(4) ?? '—'} color="#22c55e" />
            <Stat label="Ajuste global" value={data.global_fit_source ?? 'no disponible'} color="#8b94a6" />
          </div>

          {/* 1. Periodos */}
          <Card
            title="FDP por periodo del día"
            subtitle={`Cuartos de 6 h · ${data.exclude_saturated ? 'HR no saturada' : 'todas las mediciones'} · curva roja = frecuencia por bin de 1 %`}
            right={
              <button onClick={fitAll} disabled={!!fitting} style={btn(!!fitting)}>
                {fitting ? <Loader2 size={13} style={SPIN} /> : <Play size={13} />}
                {fitting ? `Ajustando (${nFits + 1}/4)…` : nFits ? 'Volver a ajustar Betas' : 'Ajustar Betas por periodo (~2 min)'}
              </button>
            }
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              {data.periods.map(p => (
                <PeriodPanel key={p.key} period={p} fit={fits[p.key]} fitting={fitting === p.key} fitError={fitErrors[p.key]} />
              ))}
            </div>
          </Card>

          {/* 2. Hora y mes */}
          <Card title="Densidad de HR por hora del día" subtitle="Una curva por hora (00-23), suavizada">
            <OverlayCurves groups={data.hours} keyName="hour" colorOf={hourColor} labelOf={h => `${String(h).padStart(2, '0')} h`} />
          </Card>
          <Card title="Densidad de HR por mes" subtitle="Una curva por mes, suavizada · época seca dic-abr, lluviosa may-nov">
            <OverlayCurves groups={data.months} keyName="month" colorOf={monthColor} labelOf={m => MONTHS[m - 1]} />
          </Card>

          {/* 2b. Tiempo de humectación */}
          <Card
            title="Tiempo de humectación (TOW, HR ≥ 80 %)"
            subtitle={`Porcentaje de horas con HR ≥ ${data.tow_threshold ?? 80} %. Datos: ${fmtPct(data.tow_pct)} · modelo (masa de la FDP ajustada a la derecha de 80 %): ${fmtPct(data.tow_model_pct)} · diferencia: ${data.tow_pct != null && data.tow_model_pct != null ? (data.tow_pct - data.tow_model_pct).toFixed(2) : '—'} puntos`}
          >
            <TowSummary data={data} />
          </Card>

          {/* 3. Análisis de tiempo */}
          {!ta && <Err msg="No hay ajuste Beta global para esta estación; no se puede hacer el análisis de tiempo." />}
          {ta && (
            <Card
              title="Análisis de tiempo de cada curva Beta"
              subtitle="Cada medición se reparte entre las curvas según cuánto aporta cada Beta en su valor de HR. Color más intenso = mayor presencia de la curva en ese mes y hora."
            >
              <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#e7eaf0' }}>
                  <thead>
                    <tr style={{ color: '#8b94a6', textAlign: 'right' }}>
                      {['Curva', 'Moda', 'Peso', 'Época seca', 'Época lluviosa', 'Día (06-17)', 'Noche', 'Mes pico', 'Hora pico'].map((h, i) => (
                        <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #272d37', textAlign: i === 0 ? 'left' : 'right', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ta.components.map((c, i) => (
                      <tr key={c.index} style={{ textAlign: 'right' }}>
                        <td style={{ padding: '6px 8px', textAlign: 'left' }}>
                          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: BETA_COLORS[i], marginRight: 6 }} />
                          Beta {c.index}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{c.mode?.toFixed(1)}%</td>
                        <td style={{ padding: '6px 8px' }}>{(c.w * 100).toFixed(1)}%</td>
                        <td style={{ padding: '6px 8px' }}>{fmtPct(c.pct_dry)}</td>
                        <td style={{ padding: '6px 8px' }}>{fmtPct(c.pct_rainy)}</td>
                        <td style={{ padding: '6px 8px' }}>{fmtPct(c.pct_day)}</td>
                        <td style={{ padding: '6px 8px' }}>{fmtPct(c.pct_night)}</td>
                        <td style={{ padding: '6px 8px' }}>{MONTHS[c.peak_month - 1]}</td>
                        <td style={{ padding: '6px 8px' }}>{String(c.peak_hour).padStart(2, '0')}:00</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, marginBottom: 16 }}>
                {ta.components.map((c, i) => <ComponentTimeCard key={c.index} comp={c} color={BETA_COLORS[i]} />)}
                <div style={{ background: '#0f1217', border: '1px solid #272d37', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e7eaf0', marginBottom: 8 }}>Curva dominante por mes y hora</div>
                  <MonthHourGrid
                    cellSize={14}
                    cellColor={(mi, h) => {
                      const k = ta.dominant_matrix[mi]?.[h] ?? 0
                      return k ? BETA_COLORS[k - 1] : '#161a21'
                    }}
                    cellTitle={(mi, h) => {
                      const k = ta.dominant_matrix[mi]?.[h] ?? 0
                      return `${MONTHS[mi]} ${String(h).padStart(2, '0')}:00 → ${k ? `Beta ${k}` : 'sin datos'}`
                    }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, fontSize: 10, color: '#8b94a6' }}>
                    {ta.components.map((c, i) => (
                      <span key={c.index} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 12, height: 12, borderRadius: 2, background: BETA_COLORS[i] }} />Beta {c.index}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#8b94a6', marginTop: 8 }}>La curva con más mediciones asignadas en cada celda.</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                <TimeProfiles components={ta.components} field="by_month_pct" labels={MONTHS} xLabel="Distribución de cada curva por mes (% de sus mediciones)" />
                <TimeProfiles components={ta.components} field="by_hour_pct" labels={Array.from({ length: 24 }, (_, h) => h)} xLabel="Distribución de cada curva por hora (% de sus mediciones)" />
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
