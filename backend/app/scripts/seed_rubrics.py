"""No-op rubric seed hook.

Problem-specific grading rubrics now live with the problem bank as optional
``*.rubric.md`` sidecars and are copied into ``problems.json`` during ingest.
``seed_from_json`` writes them to the database.
"""

from __future__ import annotations


def main() -> int:
    print("seeded grading_rubric_md: 0 row(s) updated (rubrics come from problem-bank sidecars)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
