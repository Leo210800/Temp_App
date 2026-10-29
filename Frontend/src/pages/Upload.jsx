import { useState, useRef } from "react"
import { useFetch } from "../hooks/useFetch"
import { stationsApi, uploadsApi } from "../services/api"
import {
  Thermometer, Droplets, Wind, FolderOpen, FileText, X,
  AlertTriangle, Info, CircleCheckBig, CircleX, ChevronDown, ChevronRight, Download,
} from "lucide-react"

const VARIABLES = [
  { key: "temperatura", code: "TEMP",   label: "Temperatura",      Icon: Thermometer, color: "#ef4444" },
  { key: "humedad",     code: "HR",     label: "Humedad Relativa", Icon: Droplets,    color: "#3b82f6" },
  { key: "viento",      code: "VIENTO", label: "Viento",           Icon: Wind,        color: "#22c55e" },
]

// ── Guía de formato para los usuarios de la versión beta ─────────────
const EJEMPLO_CSV = [
  "anio;mes;dia;" + Array.from({ length: 24 }, (_, i) => `H${i + 1}`).join(";"),
  "2024;1;1;88,2;89,0;90,1;91,3;92,0;-;85,4;78,9;70,2;64,8;60,1;57,3;55,0;54,8;56,2;60,5;66,9;73,4;78,8;82,1;84,6;86,0;87,1;87,9",
  "2024;1;2;88,5;89,4;90,0;91,8;92,4;93,0;86,1;79,5;71,0;65,2;60,9;58,0;56,1;55,5;57,0;61,2;67,5;74,0;79,1;82,8;85,0;86,4;87,5;88,1",
].join("\r\n")

const descargarEjemplo = () => {
  const blob = new Blob([EJEMPLO_CSV], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = "Humedad_Ejemplo_2024.csv"; a.click()
  URL.revokeObjectURL(url)
}

const REGLAS = [
  ["Un archivo por variable", "El nombre del archivo debe decir la variable: Humedad, Temperatura o Viento. Ej.: Humedad_Nicoya_2024.csv"],
  ["Encabezado", "anio;mes;dia;H1;H2;…;H24 (escribir anio sin ñ; también sirven year, month, day)"],
  ["Separador", "Punto y coma (;). En Excel: Guardar como → CSV delimitado por punto y coma, o subir el .xlsx"],
  ["Decimales", "Con coma o con punto: 88,2 o 88.2"],
  ["Datos faltantes", "Guion (-) o celda vacía; no inventar valores"],
  ["Horas", "H1 = 01:00 … H24 = medianoche (se guarda como las 00:00 del día siguiente). No usar 01:00, 02:00 con cero adelante"],
  ["Humedad relativa", "En %, de 0 a 100; quitar valores negativos o mayores a 100 antes de subir"],
]

const ERRORES = [
  ["Tipo de variable no detectado", "Renombrar el archivo con la variable, por ejemplo Humedad_Nicoya_2024.csv"],
  ["No se pudo parsear el archivo", "Revisar el encabezado (anio, mes, dia, H1…H24) y que el separador sea punto y coma"],
  ["Se cargaron menos datos de lo esperado", "Las horas están escritas 01:00, 02:00…; cambiarlas a H1…H24"],
  ["La variable detectada es otra", "El nombre menciona dos variables; dejar solo una"],
]

function GuiaFormato() {
  const [abierta, setAbierta] = useState(false)
  const th = { textAlign: "left", padding: "6px 8px", color: "var(--text-muted)", fontWeight: 600, borderBottom: "1px solid var(--border, #272d37)" }
  const td = { padding: "6px 8px", verticalAlign: "top", borderBottom: "1px solid var(--border, #272d37)" }
  return (
    <div className="alert alert--info" style={{ fontSize: 12, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Info size={16} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}><strong>Formato esperado:</strong> separador punto y coma (;) · columnas anio, mes, dia, H1…H24 · valores faltantes con guion (-) · el nombre del archivo dice la variable</span>
        <button type="button" className="btn btn--ghost" onClick={() => setAbierta(a => !a)} style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
          {abierta ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {abierta ? "Ocultar guía" : "Ver guía de formato"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={descargarEjemplo} style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Download size={14} /> CSV de ejemplo
        </button>
      </div>

      {abierta && (
        <div style={{ display: "grid", gap: 14, color: "var(--text, #e7eaf0)" }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Pasos</div>
            <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Verificar que la estación exista (menú Estaciones → Nueva estación).</li>
              <li>Elegir la estación arriba: los datos quedan guardados en la estación elegida.</li>
              <li>Arrastrar cada archivo a su recuadro: Temperatura, Humedad Relativa o Viento.</li>
              <li>Revisar la vista previa y la variable detectada antes de subir.</li>
              <li>Pulsar Subir y esperar: la app recalcula las estadísticas al terminar.</li>
              <li>Probar primero con un archivo pequeño (un mes) y revisarlo en Análisis.</li>
            </ol>
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Ejemplo (una fila por día, 24 columnas de horas)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontFamily: "monospace", fontSize: 11 }}>
                <thead>
                  <tr>{["anio", "mes", "dia", "H1", "H2", "H3", "H4", "H5", "H6", "…", "H24"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  <tr>{["2024", "1", "1", "88,2", "89,0", "90,1", "91,3", "92,0", "-", "…", "87,9"].map((c, i) => <td key={i} style={td}>{c}</td>)}</tr>
                  <tr>{["2024", "1", "2", "88,5", "89,4", "90,0", "91,8", "92,4", "93,0", "…", "88,1"].map((c, i) => <td key={i} style={td}>{c}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Reglas</div>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <tbody>{REGLAS.map(([k, v]) => <tr key={k}><td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{k}</td><td style={td}>{v}</td></tr>)}</tbody>
            </table>
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Errores comunes</div>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={th}>Mensaje o síntoma</th><th style={th}>Solución</th></tr></thead>
              <tbody>{ERRORES.map(([k, v]) => <tr key={k}><td style={{ ...td, fontWeight: 600 }}>{k}</td><td style={td}>{v}</td></tr>)}</tbody>
            </table>
          </div>

          <div style={{ color: "var(--text-muted)" }}>
            Si se sube el mismo periodo dos veces, no se duplica: el archivo nuevo reemplaza los valores de esas fechas y horas.
          </div>
        </div>
      )}
    </div>
  )
}

const parsearCSV = (texto) => {
  const lineas = texto.trim().split("\n").filter(Boolean)
  const sep = lineas[0].includes(";") ? ";" : ","

  const _norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

  // ── Formato Viento (IMN): bloque de metadatos arriba + encabezado
  //    Fecha;Hora;…;Velocidad;Dirección en una fila más abajo ──────────
  const hWind = lineas.findIndex(l => {
    const cn = l.split(sep).map(c => _norm(c.trim()))
    return cn.includes("fecha") && cn.some(c => c.startsWith("velocidad"))
  })
  if (hWind !== -1) {
    const columnas = lineas[hWind].split(sep)
      .map(c => c.trim()).filter(c => c !== "").slice(0, 6)
    const filas = lineas.slice(hWind + 1, hWind + 4)
      .map(l => l.split(sep).map(c => c.trim()).slice(0, 6))
    const totalFilas = lineas.length - (hWind + 1)
    const totalFaltantes = lineas.slice(hWind + 1).reduce((acc, l) =>
      acc + l.split(sep).filter(c => c.trim() === "-" || c.trim() === "-9").length, 0
    )
    return { columnas, filas, totalFilas, totalFaltantes, variableDetectada: "Viento", formato: "WIND" }
  }

  // ── Formato C: metadata en filas 0-3 (Estacion:;NOMBRE…) ──────────
  const primeraCelda = lineas[0].split(sep)[0].trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
  if (primeraCelda === "estacion:" || primeraCelda === "estacion") {
    // Variable detectada en fila 2
    const celdaVar = lineas[2]?.split(sep) ?? []
    const textoVar = celdaVar.join(" ").toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
    const variableDetectada =
      textoVar.includes("temperatura") ? "Temperatura" :
      textoVar.includes("humedad")     ? "Humedad"     :
      textoVar.includes("radiaci")     ? "Radiacion"   :
      textoVar.includes("viento")      ? "Viento"      : "Desconocida"

    // Encabezados en fila 3, datos desde fila 4
    const columnas = lineas[3].split(sep)
      .filter(c => !c.trim().startsWith("Unnamed") && c.trim() !== "")
      .slice(0, 7)
      .map(c => c.trim())

    const filas = lineas.slice(4, 7).map(l =>
      l.split(sep)
       .filter((_, i) => i !== 1)   // quitar columna vacía (índice 1)
       .slice(0, 7)
       .map(c => c.trim())
    )
    const totalFilas = lineas.length - 4
    const totalFaltantes = lineas.slice(4).reduce((acc, l) =>
      acc + l.split(sep).filter(c => c.trim() === "-" || c.trim() === "-9").length, 0
    )
    return { columnas, filas, totalFilas, totalFaltantes, variableDetectada, formato: "C" }
  }

  // ── Formatos A / B: encabezado en fila 0 o 1 ──────────────────────
  const columnas = lineas[0].split(sep).map(c => c.trim().replace(/^\uFEFF/, ""))
  const colsNorm = columnas.map(c =>
    c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  )
  const esHorario = colsNorm.includes("ano") && colsNorm.includes("h1")
  const esViento  = colsNorm.includes("fecha") && colsNorm.includes("velocidad")
  if (!esHorario && !esViento) throw new Error("formato_desconocido")

  const filas = lineas.slice(1, 4).map(l => l.split(sep).slice(0, 6).map(c => c.trim()))
  const totalFilas = lineas.length - 1
  const totalFaltantes = lineas.slice(1).reduce((acc, l) =>
    acc + l.split(sep).filter(c => c.trim() === "-" || c.trim() === "-9").length, 0
  )
  return { columnas: columnas.slice(0, 6), filas, totalFilas, totalFaltantes, formato: "AB" }
}

function DropZone({ variable, archivo, preview, error, onFile, onQuitar }) {
  const ref = useRef()
  const [drag, setDrag] = useState(false)
  const { Icon } = variable

  const handleDrop = (e) => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  return (
    <div className="card" style={{ borderColor: archivo ? "var(--accent-border)" : "var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: variable.color, display: "inline-flex" }}><Icon size={18} /></span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{variable.label}</span>
        </div>
        {archivo && <span className="chip" style={{ "--chip-color": "var(--success)" }}>Listo</span>}
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => !archivo && ref.current.click()}
        className={`dropzone ${drag ? "dropzone--active" : ""} ${archivo ? "dropzone--has-file" : ""}`}
        style={{ padding: "14px 16px", borderRadius: "var(--radius)" }}
      >
        <input ref={ref} type="file" accept=".csv,.xlsx" style={{ display: "none" }} onChange={e => e.target.files[0] && onFile(e.target.files[0])} />

        {archivo ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
              <FileText size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 500, fontSize: 13, color: "var(--text)" }}>{archivo.name}</div>
                <div className="num" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {(archivo.size / 1024).toFixed(1)} KB
                  {preview && ` · ${preview.totalFilas} filas · `}
                  {preview && <span style={{ color: preview.totalFaltantes > 0 ? "var(--warning)" : "var(--success)" }}>{preview.totalFaltantes} faltantes</span>}
                </div>
              </div>
            </div>
            <button className="icon-btn icon-btn--danger" onClick={e => { e.stopPropagation(); onQuitar() }} aria-label="Quitar archivo">
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="dropzone__hint">
            <FolderOpen size={22} />
            <span style={{ fontSize: 13 }}>Arrastrá o <span style={{ color: variable.color, fontWeight: 600 }}>seleccioná</span> el archivo CSV / Excel</span>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert--error" style={{ marginTop: 10, fontSize: 12 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} /> {error}
        </div>
      )}

      {preview && !error && (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table className="table" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                {preview.columnas.map(c => (
                  <th key={c} style={{ whiteSpace: "nowrap" }}>{c}</th>
                ))}
                <th>…</th>
              </tr>
            </thead>
            <tbody>
              {preview.filas.map((fila, i) => (
                <tr key={i}>
                  {fila.map((c, j) => (
                    <td key={j} className="num" style={{ color: c === "-" || c === "-9" ? "var(--danger)" : "var(--text-muted)", whiteSpace: "nowrap" }}>{c}</td>
                  ))}
                  <td style={{ color: "var(--text-muted)" }}>…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Upload() {
  const { data: stationsData } = useFetch(() => stationsApi.getAll())
  const stations = stationsData || []

  const [stationId,  setStationId]  = useState("")
  const [archivos,   setArchivos]   = useState({ temperatura: null, humedad: null, viento: null })
  const [previews,   setPreviews]   = useState({ temperatura: null, humedad: null, viento: null })
  const [errores,    setErrores]    = useState({ temperatura: "",   humedad: "",   viento: ""   })
  const [cargando,   setCargando]   = useState(false)
  const [resultados, setResultados] = useState({})
  const [subido,     setSubido]     = useState(false)

  const handleFile = (key, file) => {
    setSubido(false); setResultados({})
    setArchivos(p => ({ ...p, [key]: file }))
    setErrores(p  => ({ ...p, [key]: "" }))
    setPreviews(p => ({ ...p, [key]: null }))
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const texto = new TextDecoder("windows-1252").decode(e.target.result)
        setPreviews(p => ({ ...p, [key]: parsearCSV(texto) }))
      } catch {
        setErrores(p => ({
          ...p,
          [key]: "Formato no reconocido. Válidos: (A/B) encabezado con año;mes;dia;H1…H24, o (C) archivo con 'Estacion:' en fila 1 y horas 1:00…24:00"
        }))
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleQuitar = (key) => {
    setArchivos(p => ({ ...p, [key]: null }))
    setPreviews(p => ({ ...p, [key]: null }))
    setErrores(p  => ({ ...p, [key]: "" }))
    setSubido(false); setResultados({})
  }

  const archivosListos  = Object.values(archivos).filter(Boolean).length
  const hayAlgunArchivo = archivosListos > 0
  const puedeSubir      = stationId && hayAlgunArchivo && !cargando

  const handleSubir = async () => {
    if (!puedeSubir) return
    setCargando(true); setResultados({})
    const nuevos = {}
    for (const v of VARIABLES) {
      if (!archivos[v.key]) continue
      try {
        const res = await uploadsApi.upload(archivos[v.key], stationId)
        nuevos[v.key] = { ok: true, data: res }
      } catch (e) {
        nuevos[v.key] = { ok: false, error: e.message }
      }
    }
    setResultados(nuevos); setCargando(false); setSubido(true)
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Cargar datos</h1>
          <p className="page__subtitle">Subí los archivos CSV de cada variable por estación</p>
        </div>
      </header>

      {/* Selector de estación */}
      <div className="card">
        <label className="field">
          <span className="field__label">Estación meteorológica *</span>
          <select
            className="field__select"
            value={stationId}
            onChange={e => { setStationId(e.target.value); setSubido(false) }}
            style={{ width: "100%" }}
          >
            <option value="">Seleccionar estación…</option>
            {stations.map(s => <option key={s.id} value={s.id}>{s.name} ({s.station_code})</option>)}
          </select>
        </label>
      </div>

      {/* Guía de formato */}
      <GuiaFormato />

      {/* Drop zones */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {VARIABLES.map(v => (
          <DropZone
            key={v.key}
            variable={v}
            archivo={archivos[v.key]}
            preview={previews[v.key]}
            error={errores[v.key]}
            onFile={f  => handleFile(v.key, f)}
            onQuitar={() => handleQuitar(v.key)}
          />
        ))}
      </div>

      {/* Botón + resultados */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {archivosListos === 0 ? "Ningún archivo cargado" : `${archivosListos} de 3 archivo${archivosListos > 1 ? "s" : ""} listo${archivosListos > 1 ? "s" : ""}`}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {VARIABLES.map(v => (
              <span key={v.key} style={{
                width: 8, height: 8, borderRadius: "50%",
                background: archivos[v.key] ? "var(--success)" : "var(--border2)",
              }} title={v.label} />
            ))}
          </div>
        </div>

        <button
          onClick={handleSubir}
          disabled={!puedeSubir}
          className="btn btn--primary"
          style={{ width: "100%" }}
        >
          {cargando
            ? "Procesando archivos…"
            : !stationId
              ? "Seleccioná una estación para continuar"
              : !hayAlgunArchivo
                ? "Seleccioná al menos un archivo"
                : `Subir ${archivosListos} archivo${archivosListos > 1 ? "s" : ""} a la base de datos`
          }
        </button>

        {subido && Object.keys(resultados).length > 0 && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(resultados).map(([key, res]) => {
              const v = VARIABLES.find(x => x.key === key)
              const VIcon = v.Icon
              return (
                <div key={key} className={`alert ${res.ok ? "alert--success" : "alert--error"}`} style={{ flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}><VIcon size={15} /> <strong>{v.label}</strong></span>
                    {res.ok ? <CircleCheckBig size={16} /> : <CircleX size={16} />}
                  </div>
                  {res.ok ? (
                    <div className="num" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {res.data.rows_inserted?.toLocaleString()} filas insertadas · Variable: {res.data.variable_type}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12 }}>{res.error}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
