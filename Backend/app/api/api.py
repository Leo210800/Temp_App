from fastapi import APIRouter

from app.api.routes import (
    stations,
    uploads,
    measurements,
    charts,
    analysis,
    local_analysis,
    hr_temporal,
)

api_router = APIRouter()

api_router.include_router(
    stations.router,
    prefix="/stations",
    tags=["Stations"]
)

api_router.include_router(
    uploads.router,
    prefix="/uploads",
    tags=["Uploads"]
)

# charts va ANTES que measurements: sus rutas específicas (/stats, /heatmap, …)
# deben registrarse antes del catch-all GET /{measurement_id} de measurements.
api_router.include_router(
    charts.router,
    prefix="/measurements",
    tags=["Charts"]
)

# Análisis temporal de HR (desarrollo-leo). También antes del catch-all de
# measurements, por la misma razón que charts.
api_router.include_router(
    hr_temporal.router,
    prefix="/measurements",
    tags=["HR temporal"]
)

api_router.include_router(
    measurements.router,
    prefix="/measurements",
    tags=["Measurements"]
)

api_router.include_router(
    analysis.router,
    prefix="/stations",
    tags=["analysis"]
)

api_router.include_router(
    local_analysis.router,   
    prefix="/local-analysis", 
    tags=["local-analysis"]
)