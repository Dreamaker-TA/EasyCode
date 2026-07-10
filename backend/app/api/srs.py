"""GET /api/reviews/due —— 今日待复习题列表。"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.mastery import DueResponse
from app.services import srs_service

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.get("/due", response_model=DueResponse)
def list_due(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> DueResponse:
    items = srs_service.query_due(db, limit=limit)
    return DueResponse(today=date.today().isoformat(), items=items)
