import pytest

from dataforge.core.schemas import SchemaValidationError, validate_sample


def test_candidate_sample_is_valid() -> None:
    sample = {
        "id": "sample-1",
        "task_name": "report-intent-distill",
        "theme": "report_intent_classification",
        "stage": "candidate",
        "context": {},
        "input": {"user_text": "帮我改正式一点"},
        "metadata": {"source": "synthetic", "difficulty": "medium", "tags": []},
    }
    validate_sample(sample)


def test_parse_failure_can_be_expressed() -> None:
    sample = {
        "id": "sample-2",
        "task_name": "report-intent-distill",
        "theme": "report_intent_classification",
        "stage": "classified",
        "context": {},
        "input": {"user_text": "帮我改正式一点"},
        "annotation": {
            "teacher_label": None,
            "teacher_raw_output": "oops",
            "parse_ok": False,
            "error_code": "invalid_teacher_output",
        },
        "metadata": {"source": "synthetic", "difficulty": "medium", "tags": []},
    }
    validate_sample(sample)


def test_reviewed_accepted_requires_human_label_match() -> None:
    sample = {
        "id": "sample-3",
        "task_name": "report-intent-distill",
        "theme": "report_intent_classification",
        "stage": "reviewed",
        "context": {},
        "input": {"user_text": "帮我改正式一点"},
        "annotation": {
            "teacher_label": "rewrite_report",
            "teacher_raw_output": '{"action":"rewrite_report"}',
            "parse_ok": True,
            "error_code": None,
            "human_label": "chat",
            "review_status": "accepted",
            "final_label": None,
        },
        "metadata": {"source": "synthetic", "difficulty": "medium", "tags": []},
    }
    with pytest.raises(SchemaValidationError):
        validate_sample(sample)
