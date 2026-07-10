"""Growth stats API."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.stats import GrowthStats
from app.services import stats_service

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/growth", response_model=GrowthStats)
def get_growth_stats(
    window_days: int = Query(default=7, ge=1, le=30),
    db: Session = Depends(get_db),
) -> GrowthStats:
    return GrowthStats(**stats_service.get_growth_stats(db, window_days=window_days))
