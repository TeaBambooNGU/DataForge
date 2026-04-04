from pathlib import Path

from dataforge.core.dedupe import exclude_historical_leakage
from dataforge.core.io import write_jsonl
from dataforge.core.registry import create_task_run, load_task_config


def test_exclude_historical_leakage_blocks_overlap_from_previous_assets(tmp_path: Path) -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.task_root = tmp_path / "report-intent-distill"

    previous_run = create_task_run(task, "run-prev-001")
    write_jsonl(
        previous_run.path_for("gold_eval"),
        [
            {
                "id": "sample-1",
                "task_name": task.name,
                "theme": "report_intent_classification",
                "stage": "gold",
                "context": {"has_visible_report": True},
                "input": {"user_text": "帮我改正式一点"},
                "metadata": {"source": "synthetic", "difficulty": "medium", "tags": []},
                "annotation": {
                    "teacher_label": "rewrite_report",
                    "teacher_raw_output": '{"action":"rewrite_report"}',
                    "parse_ok": True,
                    "error_code": None,
                    "human_label": "rewrite_report",
                    "review_status": "gold_frozen",
                    "final_label": "rewrite_report",
                },
            }
        ],
    )

    current_run = create_task_run(task, "run-cur-001")
    samples = [
        {
            "id": "sample-1",
            "task_name": task.name,
            "theme": "report_intent_classification",
            "stage": "classified",
            "context": {"has_visible_report": True},
            "input": {"user_text": "帮我改正式一点"},
            "metadata": {"source": "synthetic", "difficulty": "medium", "tags": []},
            "annotation": {
                "teacher_label": "rewrite_report",
                "teacher_raw_output": '{"action":"rewrite_report"}',
                "parse_ok": True,
                "error_code": None,
                "human_label": None,
                "review_status": "unreviewed",
                "final_label": None,
            },
        }
    ]

    result = exclude_historical_leakage(current_run, samples)

    assert result.kept == []
    assert result.summary["blocked_count"] == 1
    assert result.blocked[0]["rejection_reason"] == "historical_leakage"
    assert result.blocked[0]["leakage_sources"] == ["gold_eval"]
