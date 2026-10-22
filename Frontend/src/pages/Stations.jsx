import { useState } from "react"
import { createPortal } from "react-dom"
import { useFetch } from "../hooks/useFetch"
import { stationsApi } from "../services/api"
import StationFilesModal from "../components/StationFilesModal"
import {
  Plus, X, MapPin, Mountain, Building2, SatelliteDish, Pencil, Trash2, AlertTriangle, FolderOpen, RefreshCw,
} from "lucide-react"

const EMPTY_FORM = {
  name: "", station_code: "", latitude: "", longitude: "", altitude_meters: "", institution: "",
}

const FIELDS = [
  { label: "Nombre *",    name: "name",            placeholder: "Estación Central" },
  { label: "Código *",    name: "station_code",    placeholder: "EST-01" },
  { label: "Latitud *",   name: "latitude",        placeholder: "9.9341",   type: "number" },
  { label: "Longitud *",  name: "longitude",       placeholder: "-84.0877", type: "number" },
  { label: "Altitud (m)", name: "altitude_meters", placeholder: "1200",     type: "number" },
  { label: "Institución", name: "institution",     placeholder: "IMN / ICE" },
]

const toForm = (s) => ({
  name:            s.name ?? "",
  station_code:    s.station_code ?? "",
  latitude:        s.latitude ?? "",
  longitude:       s.longitude ?? "",
  altitude_meters: s.altitude_meters ?? "",
  institution:     s.institution ?? "",
})

const toPayload = (f) => ({
  name:            f.name.trim(),
  station_code:    f.station_code.trim(),
  latitude:        parseFloat(f.latitude),
  longitude:       parseFloat(f.longitude),
  altitude_meters: f.altitude_meters !== "" ? parseFloat(f.altitude_meters) : null,
  institution:     f.institution.trim() || null,
})

function validate(f) {
  if (!String(f.name).trim() || !String(f.station_code).trim() || f.latitude === "" || f.longitude === "")
    return "Nombre, código, latitud y longitud son obligatorios."
  const lat = parseFloat(f.latitude), lon = parseFloat(f.longitude)
  if (Number.isNaN(lat) || lat < -90 || lat > 90)    return "La latitud debe estar entre -90 y 90."
  if (Number.isNaN(lon) || lon < -180 || lon > 180)  return "La longitud debe estar entre -180 y 180."
  return ""
}

export default function Stations() {
  const { data, loading, error, refetch } = useFetch(() => stationsApi.getAll())

  // Modal crear / editar (editing = null → crear)
  const [showModal, setShowModal] = useState(false)
  const [editing,   setEditing]   = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState("")
  const [form,      setForm]      = useState(EMPTY_FORM)

  // Modal eliminar
  const [toDelete,     setToDelete]     = useState(null)
  const [usage,        setUsage]        = useState(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [confirmCode,  setConfirmCode]  = useState("")
  const [deleting,     setDeleting]     = useState(false)
  const [deleteError,  setDeleteError]  = useState("")

  // Modal archivos cargados
  const [filesOf, setFilesOf] = useState(null)

  const [notice, setNotice] = useState("")
  const [noticeKind, setNoticeKind] = useState("success")

  // Recálculo de estadísticas (id de la estación en proceso)
  const [recalcId, setRecalcId] = useState(null)

  const handleRecalculate = async (s) => {
    setRecalcId(s.id)
    setNotice("")
    try {
      const res = await stationsApi.recalculate(s.id)
      setNoticeKind(res.recalc_ok ? "success" : "warning")
      setNotice(res.recalc_ok
        ? `Estadísticas de "${s.name}" recalculadas (${res.variables.join(", ")}).`
        : `Se recalcularon las estadísticas de "${s.name}", pero parte del proceso falló. Revisa la terminal del backend.`)
    } catch (e) {
      setNoticeKind("error")
      setNotice(`No se pudieron recalcular las estadísticas de "${s.name}": ${e.message}`)
    } finally {
      setRecalcId(null)
    }
  }

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setSaveError("")
    setShowModal(true)
  }

  const openEdit = (s) => {
    setEditing(s)
    setForm(toForm(s))
    setSaveError("")
    setShowModal(true)
  }

  const closeModal = () => { if (!saving) setShowModal(false) }

  const handleSave = async () => {
    const msg = validate(form)
    if (msg) { setSaveError(msg); return }
    setSaving(true)
    setSaveError("")
    try {
      if (editing) {
        await stationsApi.update(editing.id, toPayload(form))
        setNoticeKind("success"); setNotice(`Estación "${form.name.trim()}" actualizada.`)
      } else {
        await stationsApi.create(toPayload(form))
        setNoticeKind("success"); setNotice(`Estación "${form.name.trim()}" creada.`)
      }
      setShowModal(false)
      setForm(EMPTY_FORM)
      refetch()
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const openDelete = async (s) => {
    setToDelete(s)
    setUsage(null)
    setConfirmCode("")
    setDeleteError("")
    setUsageLoading(true)
    try {
      setUsage(await stationsApi.usage(s.id))
    } catch {
      setUsage(null)   // si falla, se pide confirmar con el código igualmente
    } finally {
      setUsageLoading(false)
    }
  }

  const closeDelete = () => { if (!deleting) setToDelete(null) }

  const hasData = !usage || usage.measurements > 0
  const canDelete = !usageLoading && !deleting && (!hasData || confirmCode.trim() === toDelete?.station_code)

  const handleDelete = async () => {
    if (!canDelete) return
    setDeleting(true)
    setDeleteError("")
    try {
      const res = await stationsApi.remove(toDelete.id)
      const extra = res?.measurements_deleted
        ? ` Se borraron ${res.measurements_deleted.toLocaleString("es")} mediciones.`
        : ""
      setNoticeKind("success"); setNotice(`Estación "${toDelete.name}" eliminada.${extra}`)
      setToDelete(null)
      refetch()
    } catch (e) {
      setDeleteError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const stations = data || []

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Estaciones</h1>
          <p className="page__subtitle">Administra las estaciones de monitoreo</p>
        </div>
        <button className="btn btn--primary" onClick={openCreate}>
          <Plus size={16} /> Nueva estación
        </button>
      </header>

      {notice && (
        <div className={`alert alert--${noticeKind} station-notice`}>
          <span>{notice}</span>
          <button className="modal__close" onClick={() => setNotice("")} aria-label="Cerrar aviso">
            <X size={16} />
          </button>
        </div>
      )}

      {loading && <p style={{ color: "var(--text-muted)", padding: "2rem" }}>Cargando estaciones…</p>}
      {error   && <div className="alert alert--error">{error}</div>}

      {!loading && !error && stations.length === 0 && (
        <div className="empty-state">
          <span className="empty-state__icon"><SatelliteDish size={40} /></span>
          <p>No hay estaciones registradas aún.</p>
          <p style={{ fontSize: 13 }}>Hacé clic en <strong>Nueva estación</strong> para agregar la primera.</p>
        </div>
      )}

      {!loading && stations.length > 0 && (
        <div className="stations-grid">
          {stations.map(s => (
            <div key={s.id} className="card">
              <div className="station-card__header">
                <h3 style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</h3>
                <span className="badge" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>
                  {s.station_code}
                </span>
              </div>
              <div className="station-card__meta num">
                <div className="station-card__meta-row">
                  <MapPin size={14} />
                  {parseFloat(s.latitude).toFixed(4)}, {parseFloat(s.longitude).toFixed(4)}
                </div>
                {s.altitude_meters != null && (
                  <div className="station-card__meta-row">
                    <Mountain size={14} /> {s.altitude_meters} m s.n.m.
                  </div>
                )}
                {s.institution && (
                  <div className="station-card__meta-row">
                    <Building2 size={14} /> <span style={{ fontFamily: "var(--font)" }}>{s.institution}</span>
                  </div>
                )}
              </div>
              <div className="station-card__footer">
                <span className="station-card__id">ID: {s.id.slice(0, 8)}…</span>
                <div className="station-card__actions">
                  <button
                    className="icon-btn"
                    onClick={() => handleRecalculate(s)}
                    disabled={recalcId !== null}
                    title={recalcId === s.id ? "Recalculando estadísticas…" : "Recalcular estadísticas"}
                    aria-label={`Recalcular estadísticas de ${s.name}`}
                  >
                    <RefreshCw size={15} style={recalcId === s.id ? { animation: "spin 0.8s linear infinite" } : undefined} />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => setFilesOf(s)}
                    title="Archivos cargados"
                    aria-label={`Archivos de ${s.name}`}
                  >
                    <FolderOpen size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => openEdit(s)}
                    title="Editar estación"
                    aria-label={`Editar ${s.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-btn icon-btn--danger"
                    onClick={() => openDelete(s)}
                    title="Eliminar estación"
                    aria-label={`Eliminar ${s.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal crear / editar — vía portal a document.body para que ningún
          transform de un ancestro (.page) altere su position: fixed */}
      {showModal && createPortal(
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h3>{editing ? "Editar estación" : "Nueva estación"}</h3>
              <button className="modal__close" onClick={closeModal} aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>

            <div className="modal__body">
              {saveError && <div className="alert alert--error">{saveError}</div>}

              {FIELDS.map(({ label, name, placeholder, type = "text" }) => (
                <label key={name} className="field">
                  <span className="field__label">{label}</span>
                  <input
                    className="field__input"
                    type={type}
                    step={type === "number" ? "any" : undefined}
                    name={name}
                    value={form[name]}
                    onChange={handleChange}
                    placeholder={placeholder}
                    style={{ width: "100%" }}
                  />
                </label>
              ))}
            </div>

            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={closeModal} disabled={saving}>Cancelar</button>
              <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear estación"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal archivos cargados */}
      {filesOf && (
        <StationFilesModal station={filesOf} onClose={() => setFilesOf(null)} />
      )}

      {/* Modal confirmar eliminación */}
      {toDelete && createPortal(
        <div className="modal-backdrop" onClick={closeDelete}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h3>Eliminar estación</h3>
              <button className="modal__close" onClick={closeDelete} aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>

            <div className="modal__body">
              {deleteError && <div className="alert alert--error">{deleteError}</div>}

              <p>
                ¿Seguro que querés eliminar <strong>{toDelete.name}</strong> ({toDelete.station_code})?
              </p>

              {usageLoading && (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Revisando datos asociados…</p>
              )}

              {!usageLoading && hasData && (
                <>
                  <div className="alert alert--warning station-delete__warn">
                    <AlertTriangle size={16} />
                    <span>
                      {usage
                        ? <>Esta estación tiene <strong>{usage.measurements.toLocaleString("es")}</strong> mediciones
                            {usage.files > 0 && <> de {usage.files} archivo{usage.files === 1 ? "" : "s"}</>}.
                            {" "}Se borrarán junto con todas sus estadísticas y no se puede deshacer.</>
                        : <>No se pudo verificar si tiene datos. Si los tiene, se borrarán y no se puede deshacer.</>}
                    </span>
                  </div>
                  <label className="field">
                    <span className="field__label">
                      Escribí el código <strong>{toDelete.station_code}</strong> para confirmar
                    </span>
                    <input
                      className="field__input"
                      value={confirmCode}
                      onChange={e => setConfirmCode(e.target.value)}
                      placeholder={toDelete.station_code}
                      autoFocus
                      style={{ width: "100%" }}
                    />
                  </label>
                </>
              )}

              {!usageLoading && !hasData && (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  La estación no tiene mediciones cargadas.
                </p>
              )}
            </div>

            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={closeDelete} disabled={deleting}>Cancelar</button>
              <button className="btn btn--danger" onClick={handleDelete} disabled={!canDelete}>
                <Trash2 size={15} /> {deleting ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
