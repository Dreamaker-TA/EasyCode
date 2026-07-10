"""Training overview API for the home screen."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.training import TrainingOverview
from app.services import training_service

router = APIRouter(prefix="/training", tags=["training"])


@router.get("/overview", response_model=TrainingOverview)
def get_training_overview(db: Session = Depends(get_db)) -> TrainingOverview:
    return TrainingOverview(**training_service.get_overview(db))
