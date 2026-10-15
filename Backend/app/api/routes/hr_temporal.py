"""
hr_temporal.py
==============
Análisis temporal de la Humedad Relativa (solo lectura: no escribe en la BD).

  GET /hr-temporal              Curvas de HR por periodo del día, hora y mes +
                                en qué horas y meses aparece cada curva Beta.
  GET /hr-temporal/period-fit   Ajuste Beta de un periodo del día (tarda ~15 s).

La lógica vive en app.services.hr_temporal_service.
"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.measurement import Measurement
from app.models.variable import Variable
from app.api.routes._shared import _apply_date_filters
from app.services.hr_temporal_service import (
    PERIODS,
    analyze_hr_temporal,
    fit_global,
    fit_period,
    prepare_frame,
)

router = APIRouter()


def _hr_variable(db: Session) -> Variable:
    variable = db.query(Variable).filter(func.upper(Variable.code) == "HR").first()
    if not variable:
        raise HTTPException(status_code=404, detail="Variable 'HR' no encontrada")
    return variable


def _load_hr(db: Session, station_id: str, variable: Variable, date_from, date_to):
    q = (
        db.query(Measurement.measured_at, Measurement.value)
        .filter(Measurement.station_id == station_id)
        .filter(Measurement.variable_id == variable.id)
    )
    q = _apply_date_filters(q, date_from, date_to)
    df = prepare_frame(q.all())
    if df.empty:
        raise HTTPException(status_code=404, detail="Sin datos de HR para los filtros indicados")
    return df


def _precalculated_fit(db: Session, station_id: str, variable: Variable) -> Optional[dict]:
    """Lee (sin modificar) el ajuste Beta global ya guardado por la app."""
    from app.models.distribution_analysis import DistributionAnalysis

    rec = (
        db.query(DistributionAnalysis)
        .filter(
            DistributionAnalysis.station_id        == station_id,
            DistributionAnalysis.variable_id       == str(variable.id),
            DistributionAnalysis.distribution_type == "beta",
        )
        .order_by(DistributionAnalysis.calculated_at.desc())
        .first()
    )
    if not rec or not rec.components_json or not rec.fdp_json:
        return None
    fdp = json.loads(rec.fdp_json)
    if not fdp or "beta1" not in fdp[0]:
        return None
    return {
        "ok":    True,
        "betas": json.loads(rec.components_json),
        "fdp":   fdp,
        "r2":    rec.r2,
        "mse":   rec.mse,
    }


@router.get("/hr-temporal")
def get_hr_temporal(
    station_id:        str           = Query(...),
    date_from:         Optional[str] = Query(None),
    date_to:           Optional[str] = Query(None),
    exclude_saturated: bool          = Query(False, description="Quita HR = 100 % de las curvas por periodo, hora y mes"),
    db: Session = Depends(get_db),
):
    variable = _hr_variable(db)
    df = _load_hr(db, station_id, variable, date_from, date_to)

    # Sin filtro de fechas se reutiliza el ajuste global que ya muestra la
    # pantalla de FDP (mismo método, mismos datos). Con filtro se ajusta al
    # vuelo sobre el rango pedido.
    global_fit, source = None, None
    if not date_from and not date_to:
        global_fit = _precalculated_fit(db, station_id, variable)
        source = "precalculado" if global_fit else None
    if global_fit is None:
        fit = fit_global(df)
        if fit["ok"]:
            global_fit, source = fit, "calculado"

    out = analyze_hr_temporal(df, global_fit, exclude_saturated=exclude_saturated)
    out["global_fit_source"] = source
    out["periods_available"] = [p["key"] for p in PERIODS]
    return out


@router.get("/hr-temporal/period-fit")
def get_hr_period_fit(
    station_id:        str           = Query(...),
    period:            str           = Query(..., pattern="^(madrugada|manana|tarde|noche)$"),
    date_from:         Optional[str] = Query(None),
    date_to:           Optional[str] = Query(None),
    exclude_saturated: bool          = Query(False),
    censor_sat:        bool          = Query(True, description="Censura XBeta en la curva de saturación"),
    db: Session = Depends(get_db),
):
    variable = _hr_variable(db)
    df = _load_hr(db, station_id, variable, date_from, date_to)
    return fit_period(df, period, exclude_saturated=exclude_saturated, censor_sat=censor_sat)
