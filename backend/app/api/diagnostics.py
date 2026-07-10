"""Environment diagnostics API."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.diagnostics import DiagnosticsResponse
from app.services import diagnostics_service

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("", response_model=DiagnosticsResponse)
def get_diagnostics(db: Session = Depends(get_db)) -> DiagnosticsResponse:
    return DiagnosticsResponse(**diagnostics_service.get_diagnostics(db))
