import pytest

from dataforge.core.review import (
    ReviewValidationError,
    apply_review_record,
    build_review_record,
    summarize_review_records,
    validate_review_record,
)


def test_build_review_record_uses_fixed_contract() -> None:
    sample = {
        "id": "sample-1",
        "task_name": "report-intent-distill",
        "input": {"user_text": "帮我改正式一点"},
        "context": {"has_visible_report": True},
        "metadata": {"tags": ["ambiguous"]},
        "annotation": {"teacher_label": "rewrite_report"},
    }
    record = build_review_record(sample)
    assert record["sample_id"] == "sample-1"
    assert record["review_decision"] == "pending"
    assert record["reviewer_label"] is None


def test_corrected_review_requires_reviewer_label() -> None:
    record = {
        "sample_id": "sample-1",
        "task_name": "report-intent-distill",
        "user_text": "帮我改正式一点",
        "teacher_label": "rewrite_report",
        "review_decision": "corrected",
        "reviewer_label": None,
    }
    with pytest.raises(ReviewValidationError):
        validate_review_record(record)


def test_apply_review_record_sets_human_label() -> None:
    sample = {
        "id": "sample-1",
        "task_name": "report-intent-distill",
        "theme": "report_intent_classification",
        "stage": "classified",
        "context": {},
        "input": {"user_text": "帮我改正式一点"},
        "annotation": {
            "teacher_label": "rewrite_report",
            "teacher_raw_output": '{"action":"rewrite_report"}',
            "parse_ok": True,
            "error_code": None,
            "human_label": None,
            "review_status": "unreviewed",
            "final_label": None,
        },
        "metadata": {"source": "synthetic", "difficulty": "medium", "tags": []},
    }
    record = {
        "sample_id": "sample-1",
        "task_name": "report-intent-distill",
        "user_text": "帮我改正式一点",
        "teacher_label": "rewrite_report",
        "review_decision": "corrected",
        "reviewer_label": "chat",
        "review_comment": "需要人工纠正",
        "reviewed_by": "reviewer-a",
        "reviewed_at": "2026-03-27T00:00:00+00:00",
    }
    reviewed = apply_review_record(sample, record)
    assert reviewed["annotation"]["human_label"] == "chat"
    assert reviewed["annotation"]["review_status"] == "corrected"
    assert len(reviewed["annotation"]["review_history"]) == 1


def test_summarize_review_records_counts_decisions() -> None:
    summary = summarize_review_records(
        [
            {"review_decision": "accepted", "reviewed_by": "alice"},
            {"review_decision": "corrected", "reviewed_by": "alice"},
            {"review_decision": "rejected", "reviewed_by": "bob"},
            {"review_decision": "pending", "reviewed_by": None},
        ]
    )
    assert summary["total"] == 4
    assert summary["accepted"] == 1
    assert summary["corrected"] == 1
    assert summary["rejected"] == 1
    assert summary["pending"] == 1
    assert summary["completion_rate"] == 0.75
    assert summary["reviewed_by"] == {"alice": 2, "bob": 1}
