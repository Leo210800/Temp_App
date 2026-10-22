import { useEffect, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { stationsApi } from "../services/api"
import { X, Trash2, FileText, AlertTriangle, Info } from "lucide-react"

const fmtDate = (iso) => {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es", { year: "numeric", month: "short", day: "numeric" })
}

const fmtDateTime = (iso) => {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("es", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/**
 * Modal con los archivos cargados de una estación.
 * Permite borrar las mediciones de un archivo; el backend recalcula
 * las estadísticas de las variables afectadas.
 * `onChanged` se llama después de borrar algo.
 */
export default function StationFilesModal({ station, onClose, onChanged }) {
  const [files,      setFiles]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState("")
  const [confirmId,  setConfirmId]  = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [result,     setResult]     = useState(null)   // { ok, text, logs }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setFiles(await stationsApi.files(station.id))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [station.id])

  useEffect(() => { load() }, [load])

  const busy = deletingId !== null
  const close = () => { if (!busy) onClose() }

  const handleDelete = async (f) => {
    setDeletingId(f.id)
    setResult(null)
    try {
      const res = await stationsApi.removeFile(station.id, f.id)
      setResult({
        ok: res.recalc_ok,
        text: res.recalc_ok
          ? `"${f.filename}" eliminado: ${res.measurements_deleted.toLocaleString("es")} mediciones borradas y estadísticas recalculadas.`
          : `"${f.filename}" eliminado (${res.measurements_deleted.toLocaleString("es")} mediciones), pero parte del recálculo falló. Las gráficas pueden estar desactualizadas.`,
        logs: res.logs || [],
      })
      setConfirmId(null)
      onChanged?.()
      await load()
    } catch (e) {
      setResult({ ok: false, text: e.message, logs: [] })
    } finally {
      setDeletingId(null)
    }
  }

  return createPortal(
    <div className="modal-backdrop" onClick={close}>
      <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <h3>Archivos de {station.name}</h3>
          <button className="modal__close" onClick={close} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="modal__body">
          {result && (
            <div className={`alert ${result.ok ? "alert--success" : "alert--warning"}`}>
              <div>{result.text}</div>
              {!result.ok && result.logs.length > 0 && (
                <details style={{ marginTop: 6, fontSize: 12 }}>
                  <summary>Ver detalle</summary>
                  <ul className="files-logs">
                    {result.logs.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
          {error && <div className="alert alert--error">{error}</div>}

          <div className="files-note">
            <Info size={14} />
            <span>
              Si dos archivos tienen fechas repetidas, esas mediciones quedan en el archivo
              subido más recientemente. Al borrarlo, esas fechas quedan vacías: no vuelven
              los valores del archivo anterior.
            </span>
          </div>

          {loading && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Cargando archivos…</p>}

          {!loading && !error && files.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Esta estación no tiene datos cargados.</p>
          )}

          {!loading && files.length > 0 && (
            <ul className="files-list">
              {files.map(f => (
                <li key={f.id ?? "sin-archivo"} className="files-item">
                  <div className="files-item__main">
                    <FileText size={16} className="files-item__icon" />
                    <div className="files-item__info">
                      <div className="files-item__name" title={f.filename}>{f.filename}</div>
                      <div className="files-item__meta">
                        {f.variables.map(v => <span key={v} className="badge files-item__var">{v}</span>)}
                        <span className="num">{f.measurements.toLocaleString("es")} mediciones</span>
                        <span>·</span>
                        <span>{fmtDate(f.date_start)} – {fmtDate(f.date_end)}</span>
                      </div>
                      <div className="files-item__meta files-item__meta--faint">
                        Subido: {fmtDateTime(f.uploaded_at)}
                        {f.rows_imported != null && f.rows_imported !== f.measurements && (
                          <> · importó {f.rows_imported.toLocaleString("es")} filas (otras fueron reemplazadas)</>
                        )}
                      </div>
                    </div>

                    {f.deletable && confirmId !== f.id && (
                      <button
                        className="icon-btn icon-btn--danger"
                        onClick={() => { setConfirmId(f.id); setResult(null) }}
                        disabled={busy}
                        title="Eliminar archivo"
                        aria-label={`Eliminar ${f.filename}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>

                  {confirmId === f.id && (
                    <div className="files-confirm">
                      <AlertTriangle size={15} />
                      <span>
                        Se borrarán {f.measurements.toLocaleString("es")} mediciones y se recalcularán
                        las estadísticas. No se puede deshacer.
                      </span>
                      <div className="files-confirm__actions">
                        <button className="btn btn--ghost btn--sm" onClick={() => setConfirmId(null)} disabled={busy}>
                          Cancelar
                        </button>
                        <button className="btn btn--danger btn--sm" onClick={() => handleDelete(f)} disabled={busy}>
                          {deletingId === f.id ? "Borrando y recalculando…" : "Eliminar"}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={close} disabled={busy}>Cerrar</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
