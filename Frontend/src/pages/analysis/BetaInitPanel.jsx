// ─────────────────────────────────────────────────────────────
// Valores iniciales de las curvas Beta de HR por el método de derivadas
// (documento de J. Rodríguez Yáñez, nov. 2026):
//   moda = cruces de + a − de la 1ª, 2ª y 3ª derivada,
//   A y B = cruces de − a + de la 3ª derivada,
//   pesos = diferencia del % acumulado entre A y B (< 1 % se suma a la derecha),
//   α y β = posición relativa de la moda en la tabla Moda–(α, β).
// Se muestra junto al ajuste actual para compararlos. Backend:
// GET /measurements/stats/beta-init
// ─────────────────────────────────────────────────────────────
import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Download, Loader2, Play } from 'lucide-react'
import { measurementsApi } from '../../services/api'

const SCALE = 100
const tick = { fontSize: 9, fill: '#8b94a6' }
const tipStyle = { background: '#161a21', border: '1px solid #272d37', borderRadius: 8, fontSize: 11 }
const th = { textAlign: 'right', padding: '4px 8px', color: '#8b94a6', fontWeight: 600, borderBottom: '1px solid #272d37', whiteSpace: 'nowrap' }
const td = { textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #1c2129', whiteSpace: 'nowrap' }
const Title = ({ children }) => <div style={{ fontSize: 12, color: '#8b94a6', margin: '14px 0 6px', fontWeight: 600 }}>{children}</div>
const fmtE = (v) => (v == null ? '—' : Number(v).toExponential(2))

function Field({ label, value, onChange, step, min, max }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8b94a6' }}>
      {label}
      <input type="number" value={value} step={step} min={min} max={max}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: 64, background: '#0f1217', color: '#e7eaf0', border: '1px solid #272d37', borderRadius: 6, padding: '3px 6px' }} />
    </label>
  )
}

function Metric({ title, m, n }) {
  return (
    <div style={{ background: '#0f1217', border: '1px solid #272d37', borderRadius: 10, padding: '10px 12px', minWidth: 170 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#e7eaf0', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 11, color: '#8b94a6', lineHeight: 1.7 }}>
        R² <b style={{ color: (m?.r2 ?? 0) >= 0.95 ? '#22c55e' : '#ef4444' }}>{m?.r2?.toFixed?.(4) ?? '—'}</b><br />
        EMC <b style={{ color: '#e7eaf0' }}>{fmtE(m?.emc)}</b><br />
        Err máx × 100 <b style={{ color: (m?.err_max ?? 1) <= 1e-3 ? '#22c55e' : '#ef4444' }}>{m?.err_max != null ? (m.err_max * SCALE).toFixed(3) : '—'}</b><br />
        Curvas <b style={{ color: '#e7eaf0' }}>{n ?? '—'}</b>
      </div>
    </div>
  )
}

function downloadCsv(name, rows) {
  const csv = rows.map(r => r.join(',')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}

export default function BetaInitPanel({ stationId }) {
  const [opts, setOpts] = useState({ solapamiento: 6, peso_minimo: 1, paso_tabla: 0.5, sat_beta: 0.8, tolerancia: 1, usar_varianza: true, derivada: 'excel', una_moda: true, sat_beta_menor_1: true })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (v) => setOpts(o => ({ ...o, [k]: v }))

  const run = async () => {
    setLoading(true); setError(null)
    try { setData(await measurementsApi.betaInit({ station_id: stationId, ...opts })) }
    catch (e) { setError(e?.message || 'No se pudo calcular') }
    finally { setLoading(false) }
  }

  const init = data?.init, fit = data?.fit
  const chart = (fit?.fdp || []).map(p => ({ x: p.x, real: p.real * SCALE, inicial: p.inicial * SCALE, modelo: p.modelo * SCALE }))
  const exportCsv = () => downloadCsv('valores_iniciales_beta_HR.csv', [
    ['Beta', 'Moda', 'A', 'B', 'P (%)', 'Posicion relativa', 'Alfa', 'Beta', 'Ancho por varianza', 'A inicial', 'B inicial'],
    ...(init?.curvas || []).map(c => [c.beta, c.moda, c.A, c.B, c.p, c.pos_rel, c.alpha, c.beta_, c.ancho_varianza ?? '', c.A_sol, c.B_sol]),
  ])

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #272d37' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e7eaf0' }}>Valores iniciales por derivadas</div>
          <div style={{ fontSize: 11, color: '#8b94a6', marginTop: 2 }}>
            Derivadas como PENDIENTE de 5 filas sobre la curva cruda · modas: cruces de + a − de la 1ª, 2ª y 3ª derivada (una por entorno) · A y B: cruces de − a + de la 3ª derivada · pesos por % acumulado · α y β por la posición de la moda.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }} data-html2canvas-ignore>
          {init && <button onClick={exportCsv} style={btn}><Download size={13} /> Tabla (CSV)</button>}
          <button onClick={run} disabled={loading || !stationId} style={{ ...btn, color: '#e7eaf0', borderColor: '#3b4452' }}>
            {loading ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Play size={13} />} Calcular
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }} data-html2canvas-ignore>
        <Field label="Solapamiento (puntos)" value={opts.solapamiento} onChange={set('solapamiento')} step={0.5} min={0} max={10} />
        <Field label="Peso mínimo (%)" value={opts.peso_minimo} onChange={set('peso_minimo')} step={0.5} min={0} max={10} />
        <Field label="Paso tabla α, β" value={opts.paso_tabla} onChange={set('paso_tabla')} step={0.1} min={0.1} max={1} />
        <Field label="β saturación" value={opts.sat_beta} onChange={set('sat_beta')} step={0.1} min={0.1} max={0.9} />
        <Field label="Modas iguales a ±" value={opts.tolerancia} onChange={set('tolerancia')} step={1} min={0} max={5} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8b94a6' }}>
          <input type="checkbox" checked={opts.usar_varianza} onChange={e => set('usar_varianza')(e.target.checked)} />
          B − A ≥ ancho por varianza
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8b94a6' }}>
          Derivadas
          <select value={opts.derivada} onChange={e => set('derivada')(e.target.value)}
            style={{ background: '#161a21', color: '#e7eaf0', border: '1px solid #272d37', borderRadius: 6, fontSize: 12, padding: '2px 4px' }}>
            <option value="excel">Curva cruda · PENDIENTE de 5 filas (Excel)</option>
            <option value="pendiente">Curva suavizada · pendiente centrada de 5 puntos</option>
            <option value="gradiente">Curva suavizada · punto a punto (anterior)</option>
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8b94a6' }}>
          <input type="checkbox" checked={opts.una_moda} onChange={e => set('una_moda')(e.target.checked)} />
          Una moda por entorno A–B
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8b94a6' }}>
          <input type="checkbox" checked={opts.sat_beta_menor_1} onChange={e => set('sat_beta_menor_1')(e.target.checked)} />
          Saturación con β &lt; 1 en el ajuste
        </label>
      </div>

      {loading && <div style={{ fontSize: 12, color: '#8b94a6', marginTop: 12 }}>Calculando y ajustando desde los valores iniciales… puede tardar hasta un minuto.</div>}
      {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 12 }}>{error}</div>}

      {init && (
        <>
          <Title>Cruces por cero de las derivadas (clase anterior/siguiente)</Title>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#e7eaf0' }}>
            <tbody>
              {[['1ª derivada, de + a − (picos)', 'd1_max'], ['2ª derivada, de + a −', 'd2_max'], ['3ª derivada, de + a −', 'd3_max'], ['3ª derivada, de − a + (límites A y B)', 'd3_min']].map(([lab, k]) => (
                <tr key={k}><td style={{ ...td, textAlign: 'left', color: '#8b94a6' }}>{lab}</td>
                  <td style={{ ...td, textAlign: 'left' }}>{(init.cruces[k] || []).map(c => c.par).join(', ') || '—'}</td></tr>
              ))}
              {init.modas_candidatas && init.modas_candidatas.length !== init.modas.length && (
                <tr><td style={{ ...td, textAlign: 'left', color: '#8b94a6' }}>Modas candidatas</td><td style={{ ...td, textAlign: 'left' }}>{init.modas_candidatas.join(', ')}</td></tr>
              )}
              <tr><td style={{ ...td, textAlign: 'left', color: '#8b94a6' }}>Modas resultantes</td><td style={{ ...td, textAlign: 'left' }}>{init.modas.join(', ')}</td></tr>
              <tr><td style={{ ...td, textAlign: 'left', color: '#8b94a6' }}>% acumulado en cada límite</td>
                <td style={{ ...td, textAlign: 'left' }}>{init.acumulado.map(a => `${a.limite}: ${a.pct.toFixed(3)}`).join(' · ')}</td></tr>
            </tbody>
          </table>

          <Title>Valores iniciales de cada curva</Title>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#e7eaf0' }}>
              <thead><tr>{['Beta', 'Moda', 'A', 'B', 'P (%)', 'Posición relativa', 'α', 'β', '(B − A)/σ', 'Ancho por varianza', 'A inicial', 'B inicial', '(B − A)/σ inicial'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{init.curvas.map(c => (
                <tr key={c.beta}>
                  <td style={td}>{c.beta}{c.saturacion ? ' (sat.)' : ''}</td><td style={td}>{c.moda}</td><td style={td}>{c.A}</td><td style={td}>{c.B}</td>
                  <td style={td}>{c.p.toFixed(1)}</td><td style={td}>{c.pos_rel.toFixed(3)}</td><td style={td}>{c.alpha}</td><td style={td}>{c.beta_}</td>
                  <td style={td}><Ratio r={c.ratio_sigma} /></td>
                  <td style={td}>{c.ancho_varianza ?? '—'}</td>
                  <td style={{ ...td, color: c.ensanchado ? '#facc15' : td.color }}>{c.A_sol}</td>
                  <td style={{ ...td, color: c.ensanchado ? '#facc15' : td.color }}>{c.B_sol}</td>
                  <td style={td}><Ratio r={c.ratio_sigma_sol} /></td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}

      {data && (
        <>
          <div style={{ fontSize: 11, color: '#5b6577', marginTop: 6 }}>
            A y B iniciales = mínimos de la 3ª derivada abiertos por el solapamiento. En amarillo, los entornos que se ensancharon porque la varianza de los datos pide un ancho mayor. (B − A)/σ con σ = desviación estándar de los datos del entorno: verde ≥ 4, amarillo entre 3 y 4, rojo &lt; 3 (revisar).
          </div>
          <Title>Comparación de los ajustes</Title>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Metric title="Ajuste actual de la app" m={data.actual} n={data.actual?.n_curvas} />
            {fit && <Metric title="Solo valores iniciales" m={fit.inicial} n={init?.curvas?.length} />}
            {fit && <Metric title="Ajuste desde valores iniciales" m={fit.final} n={fit.curvas?.length} />}
          </div>
        </>
      )}

      {fit && (
        <>
          <Title>FDP real, curva inicial y ajuste desde los valores iniciales (frecuencia × 100)</Title>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chart} margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#272d37" strokeOpacity={0.5} />
              <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]} tick={tick} unit="%" />
              <YAxis tick={tick} tickFormatter={v => v.toFixed(1)} />
              <Tooltip contentStyle={tipStyle} labelFormatter={v => `HR ${v}%`} formatter={(v, n) => [Number(v).toFixed(3), n]} />
              <Line dataKey="real" name="FDP real" stroke="#ef4444" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line dataKey="inicial" name="Valores iniciales" stroke="#eab308" strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line dataKey="modelo" name="Ajuste" stroke="#e2e8f0" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>

          <Title>Curvas después del ajuste</Title>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#e7eaf0' }}>
              <thead><tr>{['Beta', 'Moda', 'A', 'B', 'P (%)', 'α', 'β', '(B − A)/σ'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{fit.curvas.map(c => (
                <tr key={c.beta}><td style={td}>{c.beta}</td><td style={td}>{c.moda}</td><td style={td}>{c.A}</td><td style={td}>{c.B}</td>
                  <td style={td}>{c.p.toFixed(1)}</td><td style={td}>{c.alpha}</td><td style={td}>{c.beta_}</td><td style={td}><Ratio r={c.ratio_sigma} /></td></tr>))}</tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#5b6577', marginTop: 6 }}>
            Prueba experimental: no reemplaza el ajuste de la app. En el ajuste, A y B pueden moverse hasta 10 puntos desde su valor inicial y los pesos suman 1.
          </div>
        </>
      )}
    </div>
  )
}

// Criterio de Javier: (B − A)/σ ≥ 4 bien, 3–4 aceptable, < 3 revisar
const ratioColor = (r) => (r == null ? '#5b6577' : r >= 4 ? '#22c55e' : r >= 3 ? '#facc15' : '#ef4444')
const Ratio = ({ r }) => <span style={{ color: ratioColor(r), fontWeight: 600 }}>{r == null ? '—' : r.toFixed(1)}</span>

const btn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 8,
  border: '1px solid #272d37', background: '#0f1217', color: '#8b94a6', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
