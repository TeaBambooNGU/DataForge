from dataforge.core.filters import filter_classified_samples


def test_invalid_rewrite_without_visible_report_is_filtered() -> None:
    result = filter_classified_samples(
        [
            {
                "id": "sample-1",
                "context": {"has_visible_report": False},
                "input": {"user_text": "帮我改正式一点"},
                "annotation": {"teacher_label": "rewrite_report", "parse_ok": True},
                "metadata": {"difficulty": "medium", "tags": []},
            }
        ],
        allowed_labels={"chat", "rewrite_report", "regenerate_report"},
        task_rules={"disallow_rewrite_without_visible_report": True},
    )
    assert len(result.kept) == 0
    assert len(result.rejected) == 1
