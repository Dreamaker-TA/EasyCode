"""PATCH /api/problems/{id}/mastery —— 用户覆盖评级。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.mastery import MasteryAfterUpdate, MasteryUpdate
from app.schemas.problem import ErrorDetail, ErrorResponse
from app.services import srs_service

router = APIRouter(prefix="/problems", tags=["mastery"])


@router.patch(
    "/{problem_id}/mastery",
    response_model=MasteryAfterUpdate,
    responses={404: {"model": ErrorResponse}},
)
def patch_mastery(
    problem_id: int,
    body: MasteryUpdate,
    db: Session = Depends(get_db),
) -> MasteryAfterUpdate:
    result = srs_service.update_user_rating(db, problem_id, body.user_rating)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="PROBLEM_NOT_FOUND", message=f"problem {problem_id} not found"
                )
            ).model_dump(),
        )
    return MasteryAfterUpdate(**result)
