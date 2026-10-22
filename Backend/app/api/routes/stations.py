import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.station import Station
from app.models.variable import Variable
from app.models.measurement import Measurement
from app.models.uploaded_file import UploadedFile
from app.models.daily_stats import DailyStats
from app.models.monthly_stats import MonthlyStats
from app.models.heatmap_stats import HeatmapStats
from app.models.distribution_analysis import DistributionAnalysis
from app.models.summary_stats import SummaryStats
from app.models.by_date_stats import ByDateStats
from app.models.annual_profile_stats import AnnualProfileStats
from app.models.combined_stats import CombinedStats
from app.schemas.station import StationCreate, StationUpdate, StationResponse

router = APIRouter()

logger = logging.getLogger(__name__)

# Tablas de estadísticas precalculadas que referencian stations.id.
# Se limpian antes de borrar una estación para no violar las llaves foráneas.
_STATS_MODELS = (
    DailyStats,
    MonthlyStats,
    HeatmapStats,
    DistributionAnalysis,
    SummaryStats,
    ByDateStats,
    AnnualProfileStats,
    CombinedStats,
)

# Campos que no pueden quedar vacíos al editar
_REQUIRED_FIELDS = ("station_code", "name", "latitude", "longitude")


def _get_station_or_404(db: Session, station_id: str) -> Station:
    try:
        sid = uuid.UUID(station_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    station = db.query(Station).filter(Station.id == sid).first()
    if not station:
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    return station


def _validate_coords(lat: float | None, lon: float | None):
    if lat is not None and not -90 <= lat <= 90:
        raise HTTPException(status_code=422, detail="La latitud debe estar entre -90 y 90")
    if lon is not None and not -180 <= lon <= 180:
        raise HTTPException(status_code=422, detail="La longitud debe estar entre -180 y 180")


# ── Variables ─────────────────────────────────────────────────────────

@router.get("/variables/all")
def get_variables(db: Session = Depends(get_db)):
    variables = db.query(Variable).order_by(Variable.code).all()
    return [
        {
            "id":   str(v.id),
            "code": v.code,
            "name": v.name,
            "unit": v.unit,
        }
        for v in variables
    ]

# ── Estaciones ────────────────────────────────────────────────────────

@router.get("/", response_model=list[StationResponse])
def get_stations(db: Session = Depends(get_db)):
    stations = db.query(Station).order_by(Station.name).all()
    # Convertir UUID a str para el schema
    for s in stations:
        s.id = str(s.id)
    return stations


@router.post("/", response_model=StationResponse, status_code=201)
def create_station(
    station: StationCreate,
    db: Session = Depends(get_db)
):
    _validate_coords(station.latitude, station.longitude)

    # Verificar código duplicado
    exists = db.query(Station).filter(
        Station.station_code == station.station_code
    ).first()
    if exists:
        raise HTTPException(
            status_code=400,
            detail=f"Ya existe una estación con código '{station.station_code}'"
        )

    db_station = Station(**station.model_dump())
    db.add(db_station)
    db.commit()
    db.refresh(db_station)
    db_station.id = str(db_station.id)
    return db_station


@router.get("/{station_id}", response_model=StationResponse)
def get_station(station_id: str, db: Session = Depends(get_db)):
    station = _get_station_or_404(db, station_id)
    station.id = str(station.id)
    return station


@router.put("/{station_id}", response_model=StationResponse)
def update_station(
    station_id: str,
    changes: StationUpdate,
    db: Session = Depends(get_db),
):
    station = _get_station_or_404(db, station_id)
    data = changes.model_dump(exclude_unset=True)

    for field in _REQUIRED_FIELDS:
        if field in data and (data[field] is None or str(data[field]).strip() == ""):
            raise HTTPException(status_code=422, detail=f"El campo '{field}' es obligatorio")

    _validate_coords(data.get("latitude"), data.get("longitude"))

    # Código único (excluyendo la propia estación)
    new_code = data.get("station_code")
    if new_code and new_code != station.station_code:
        dup = db.query(Station).filter(
            Station.station_code == new_code,
            Station.id != station.id,
        ).first()
        if dup:
            raise HTTPException(
                status_code=400,
                detail=f"Ya existe una estación con código '{new_code}'"
            )

    old_altitude = float(station.altitude_meters) if station.altitude_meters is not None else None

    for field, value in data.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(station, field, value)

    db.commit()
    db.refresh(station)

    # La humedad absoluta del análisis combinado T–HR depende de la altitud
    # (presión atmosférica). Si cambió, se recalcula para no mostrar datos viejos.
    new_altitude = float(station.altitude_meters) if station.altitude_meters is not None else None
    if "altitude_meters" in data and new_altitude != old_altitude:
        has_combined = db.query(CombinedStats).filter(CombinedStats.station_id == station.id).first()
        if has_combined:
            try:
                from app.services.stats_service import _recalc_combined_stats
                _recalc_combined_stats(db, str(station.id), altitude=new_altitude or 0.0)
                logger.info("combined_stats recalculado para %s (altitud %s → %s)",
                            station.station_code, old_altitude, new_altitude)
            except Exception:
                db.rollback()
                logger.exception("No se pudo recalcular combined_stats tras cambiar la altitud")
            db.refresh(station)

    station.id = str(station.id)
    return station


@router.get("/{station_id}/usage")
def get_station_usage(station_id: str, db: Session = Depends(get_db)):
    """Cuántos datos tiene la estación (para advertir antes de eliminarla)."""
    station = _get_station_or_404(db, station_id)
    n_measurements = (
        db.query(Measurement).filter(Measurement.station_id == station.id).count()
    )
    n_files = (
        db.query(Measurement.file_id)
        .filter(Measurement.station_id == station.id, Measurement.file_id.isnot(None))
        .distinct()
        .count()
    )
    return {"measurements": n_measurements, "files": n_files}


@router.delete("/{station_id}")
def delete_station(station_id: str, db: Session = Depends(get_db)):
    """
    Elimina la estación junto con sus mediciones y estadísticas precalculadas.
    Los registros de archivos subidos que queden sin mediciones también se borran.
    Todo ocurre en una sola transacción: si algo falla, no se borra nada.
    """
    station = _get_station_or_404(db, station_id)
    sid = station.id

    try:
        file_ids = [
            fid for (fid,) in
            db.query(Measurement.file_id)
            .filter(Measurement.station_id == sid, Measurement.file_id.isnot(None))
            .distinct()
            .all()
        ]

        for model in _STATS_MODELS:
            db.query(model).filter(model.station_id == sid).delete(synchronize_session=False)

        n_measurements = (
            db.query(Measurement)
            .filter(Measurement.station_id == sid)
            .delete(synchronize_session=False)
        )

        # Archivos que ya no tienen mediciones de ninguna estación
        n_files = 0
        for fid in file_ids:
            still_used = db.query(Measurement.id).filter(Measurement.file_id == fid).first()
            if not still_used:
                n_files += (
                    db.query(UploadedFile)
                    .filter(UploadedFile.id == fid)
                    .delete(synchronize_session=False)
                )

        db.delete(station)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"No se pudo eliminar la estación: {e}")

    return {
        "deleted": True,
        "station_id": str(sid),
        "measurements_deleted": n_measurements,
        "files_deleted": n_files,
    }


# ── Archivos cargados de una estación ────────────────────────────────

def _parse_uuid_or_404(value: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{what} no encontrado")


@router.get("/{station_id}/files")
def get_station_files(station_id: str, db: Session = Depends(get_db)):
    """
    Archivos que aportan mediciones a la estación.

    Ojo: al subir un archivo, las mediciones con la misma fecha-hora se
    sobrescriben y pasan al archivo nuevo. Por eso `measurements` es lo que
    el archivo aporta HOY, que puede ser menos que `rows_imported`.
    """
    station = _get_station_or_404(db, station_id)

    rows = (
        db.query(
            Measurement.file_id,
            Variable.code,
            func.count(Measurement.id),
            func.min(Measurement.measured_at),
            func.max(Measurement.measured_at),
        )
        .join(Variable, Variable.id == Measurement.variable_id)
        .filter(Measurement.station_id == station.id)
        .group_by(Measurement.file_id, Variable.code)
        .all()
    )

    by_file: dict = {}
    for fid, code, count, dmin, dmax in rows:
        key = str(fid) if fid else None
        f = by_file.setdefault(key, {
            "id": key, "measurements": 0, "variables": [],
            "date_start": None, "date_end": None,
        })
        f["measurements"] += count
        f["variables"].append(code)
        if dmin and (f["date_start"] is None or dmin < f["date_start"]):
            f["date_start"] = dmin
        if dmax and (f["date_end"] is None or dmax > f["date_end"]):
            f["date_end"] = dmax

    file_ids = [uuid.UUID(k) for k in by_file if k]
    meta = {
        str(u.id): u
        for u in db.query(UploadedFile).filter(UploadedFile.id.in_(file_ids)).all()
    } if file_ids else {}

    result = []
    for key, f in by_file.items():
        u = meta.get(key) if key else None
        result.append({
            "id":            key,
            "filename":      u.filename if u else ("(sin archivo asociado)" if not key else "(registro no encontrado)"),
            "uploaded_at":   u.uploaded_at.isoformat() if u and u.uploaded_at else None,
            "status":        u.status if u else None,
            "rows_imported": u.rows_imported if u else None,
            "measurements":  f["measurements"],
            "variables":     sorted(f["variables"]),
            "date_start":    f["date_start"].isoformat() if f["date_start"] else None,
            "date_end":      f["date_end"].isoformat() if f["date_end"] else None,
            "deletable":     key is not None,
        })

    # Más recientes primero; los que no tienen fecha (o archivo) al final
    with_date = [r for r in result if r["uploaded_at"]]
    without   = [r for r in result if not r["uploaded_at"]]
    with_date.sort(key=lambda r: r["uploaded_at"], reverse=True)
    return with_date + without


def _clear_variable_stats(db: Session, sid: uuid.UUID, vid: uuid.UUID):
    """Borra las estadísticas precalculadas de una estación+variable sin datos."""
    for model in (DailyStats, MonthlyStats, HeatmapStats, DistributionAnalysis,
                  SummaryStats, ByDateStats, AnnualProfileStats):
        db.query(model).filter(
            model.station_id == sid, model.variable_id == vid
        ).delete(synchronize_session=False)


def _recompute_variable(db: Session, sid: uuid.UUID, vid: uuid.UUID, code: str) -> list[str]:
    """
    Recalcula las estadísticas de una estación+variable igual que al subir
    un archivo. Si ya no quedan mediciones, las borra.
    """
    from app.services.analytics_service import run_analytics, upsert_summary_stats
    from app.services.stats_service import recalculate_derived_stats

    logs: list[str] = []
    remaining = db.query(Measurement.id).filter(
        Measurement.station_id == sid, Measurement.variable_id == vid
    ).first()

    if not remaining:
        _clear_variable_stats(db, sid, vid)
        db.commit()
        logs.append(f"🧹 {code}: sin mediciones restantes, estadísticas eliminadas")
        return logs

    s, v = str(sid), str(vid)

    # La dirección del viento solo lleva summary (igual que en uploads.py)
    if code == "VIENTO_DIR":
        try:
            upsert_summary_stats(db=db, station_id=s, variable_id=v)
            logs.append(f"✅ {code}: summary recalculado")
        except Exception as e:
            db.rollback()
            logs.append(f"⚠️ {code}: summary falló: {e}")
        return logs

    try:
        res = run_analytics(db=db, station_id=s, variable_id=v, variable_code=code)
        logs += res.get("logs", [])
        upsert_summary_stats(db=db, station_id=s, variable_id=v)
    except Exception as e:
        db.rollback()
        logs.append(f"⚠️ {code}: analytics falló: {e}")

    try:
        derived = recalculate_derived_stats(db=db, station_id=s, variable_id=v, variable_code=code)
        logs += derived.get("logs", [])
    except Exception as e:
        db.rollback()
        logs.append(f"⚠️ {code}: estadísticas derivadas fallaron: {e}")

    return logs


@router.post("/{station_id}/recalculate")
def recalculate_station(station_id: str, db: Session = Depends(get_db)):
    """
    Recalcula TODAS las estadísticas precalculadas de la estación (diarias,
    mensuales, mapa de calor, ajuste de la FDP, resumen, por fecha, perfil
    anual y análisis combinado) a partir de sus mediciones, igual que al
    subir un archivo. Útil después de vaciar las tablas de estadísticas.
    """
    station = _get_station_or_404(db, station_id)
    sid = station.id

    variables = (
        db.query(Variable.id, Variable.code)
        .join(Measurement, Measurement.variable_id == Variable.id)
        .filter(Measurement.station_id == sid)
        .distinct()
        .all()
    )
    if not variables:
        raise HTTPException(status_code=404, detail="La estación no tiene mediciones para recalcular")

    logs: list[str] = []
    for vid, code in variables:
        try:
            logs += _recompute_variable(db, sid, vid, code)
        except Exception as e:
            db.rollback()
            logger.exception("Recalculo falló para %s", code)
            logs.append(f"⚠️ {code}: recálculo falló: {e}")

    warnings = [l for l in logs if l.startswith(("⚠️", "❌"))]
    return {
        "station_id": str(sid),
        "variables":  sorted(code for _, code in variables),
        "recalc_ok":  not warnings,
        "logs":       logs,
    }


@router.delete("/{station_id}/files/{file_id}")
def delete_station_file(station_id: str, file_id: str, db: Session = Depends(get_db)):
    """
    Borra las mediciones que un archivo aporta a la estación y recalcula
    las estadísticas de las variables afectadas.

    1. Borrado de mediciones (transacción; si falla no se borra nada).
    2. Recálculo por variable (si falla, los datos ya están borrados y las
       gráficas quedan desactualizadas hasta recalcular; se avisa en `logs`).
    """
    station = _get_station_or_404(db, station_id)
    sid = station.id
    fid = _parse_uuid_or_404(file_id, "Archivo")

    affected = (
        db.query(Variable.id, Variable.code)
        .join(Measurement, Measurement.variable_id == Variable.id)
        .filter(Measurement.station_id == sid, Measurement.file_id == fid)
        .distinct()
        .all()
    )
    if not affected:
        raise HTTPException(status_code=404, detail="Este archivo no tiene mediciones en la estación")

    # ── 1. Borrar mediciones ──────────────────────────────────
    try:
        n_deleted = (
            db.query(Measurement)
            .filter(Measurement.station_id == sid, Measurement.file_id == fid)
            .delete(synchronize_session=False)
        )
        file_record_deleted = False
        if not db.query(Measurement.id).filter(Measurement.file_id == fid).first():
            file_record_deleted = bool(
                db.query(UploadedFile).filter(UploadedFile.id == fid)
                .delete(synchronize_session=False)
            )
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"No se pudo borrar el archivo: {e}")

    # ── 2. Recalcular estadísticas ────────────────────────────
    logs: list[str] = [f"🗑️ {n_deleted:,} mediciones eliminadas"]
    codes = {code for _, code in affected}
    for vid, code in affected:
        try:
            logs += _recompute_variable(db, sid, vid, code)
        except Exception as e:
            db.rollback()
            logger.exception("Recalculo falló para %s", code)
            logs.append(f"⚠️ {code}: recálculo falló: {e}")

    # combined_stats necesita TEMP y HR; si falta alguna, se borra
    if codes & {"TEMP", "HR"}:
        try:
            have = {
                code for (code,) in
                db.query(Variable.code)
                .join(Measurement, Measurement.variable_id == Variable.id)
                .filter(Measurement.station_id == sid, Variable.code.in_(["TEMP", "HR"]))
                .distinct()
                .all()
            }
            if have != {"TEMP", "HR"}:
                db.query(CombinedStats).filter(CombinedStats.station_id == sid).delete(synchronize_session=False)
                db.commit()
                logs.append("🧹 combined_stats eliminado (falta TEMP o HR)")
        except Exception as e:
            db.rollback()
            logs.append(f"⚠️ combined_stats: no se pudo limpiar: {e}")

    warnings = [l for l in logs if l.startswith(("⚠️", "❌"))]
    return {
        "deleted":              True,
        "file_id":              str(fid),
        "measurements_deleted": n_deleted,
        "file_record_deleted":  file_record_deleted,
        "variables":            sorted(codes),
        "recalc_ok":            not warnings,
        "logs":                 logs,
    }
