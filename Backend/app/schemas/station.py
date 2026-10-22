from pydantic import BaseModel


class StationCreate(BaseModel):
    station_code:    str
    name:            str
    latitude:        float
    longitude:       float
    altitude_meters: float | None = None
    institution:     str   | None = None


class StationUpdate(BaseModel):
    """Edición parcial: solo se actualizan los campos enviados."""
    station_code:    str   | None = None
    name:            str   | None = None
    latitude:        float | None = None
    longitude:       float | None = None
    altitude_meters: float | None = None
    institution:     str   | None = None


class StationResponse(StationCreate):
    id: str

    class Config:
        from_attributes = True
