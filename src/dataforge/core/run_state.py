from __future__ import annotations


RUN_STATUS_ORDER = {
    "created": 0,
    "generated": 1,
    "classified": 2,
    "filtered": 3,
    "review_exported": 4,
    "review_validated": 5,
    "gold_built": 6,
    "evaluated": 7,
}

STAGE_TO_STATUS = {
    "generate": "generated",
    "classify": "classified",
    "filter_export": "filtered",
    "review_export": "review_exported",
    "validate_review": "review_validated",
    "build_gold": "gold_built",
    "eval": "evaluated",
}
