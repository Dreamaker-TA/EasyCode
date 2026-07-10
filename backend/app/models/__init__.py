"""模型包。

显式 re-export 让 Alembic 的 autogenerate（以及 import 整个包）能发现所有表。
"""

from app.models.mastery import Mastery
from app.models.problem import Problem
from app.models.review_schedule import ReviewSchedule
from app.models.snapshot import Snapshot
from app.models.submission import Submission
from app.models.tutor_message import TutorMessage

__all__ = [
    "Problem",
    "Submission",
    "Snapshot",
    "Mastery",
    "ReviewSchedule",
    "TutorMessage",
]
