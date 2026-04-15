from pathlib import Path

from dataforge.core.exporters import build_promptfoo_eval_rows, export_eval_dataset, export_train_dataset
from dataforge.core.io import read_jsonl


def test_export_train_dataset_supports_chatml_jsonl(tmp_path: Path) -> None:
    path = tmp_path / "train.jsonl"
    samples = [
        {
            "id": "sample-1",
            "task_name": "report-intent-distill",
            "input": {"user_text": "帮我改正式一点"},
            "annotation": {"teacher_label": "rewrite_report"},
            "context": {"has_visible_report": True},
            "metadata": {"difficulty": "medium", "tags": []},
        }
    ]

    summary = export_train_dataset(
        path,
        samples,
        "chatml_jsonl",
        system_prompt='你是一个分类器。只输出 {"action":"..."}',
    )
    rows = read_jsonl(path)

    assert summary["format"] == "chatml_jsonl"
    assert list(rows[0].keys()) == ["messages"]
    assert rows[0]["messages"][0]["role"] == "system"
    assert rows[0]["messages"][1]["role"] == "user"
    assert rows[0]["messages"][2]["content"] == '{"action":"rewrite_report"}'


def test_export_eval_dataset_supports_prediction_jsonl(tmp_path: Path) -> None:
    path = tmp_path / "eval.jsonl"
    eval_rows = [
        {
            "id": "sample-1",
            "user_text": "帮我重写一下",
            "expected_label": "rewrite_report",
            "predicted_label": "rewrite_report",
            "parse_ok": True,
        }
    ]

    summary = export_eval_dataset(path, eval_rows, "prediction_jsonl")
    rows = read_jsonl(path)

    assert summary["format"] == "prediction_jsonl"
    assert rows == eval_rows


def test_build_promptfoo_eval_rows_reuses_expected_shape() -> None:
    rows = build_promptfoo_eval_rows(
        [
            {
                "id": "sample-1",
                "user_text": "帮我重写一下",
                "expected_label": "rewrite_report",
                "predicted_label": "rewrite_report",
                "parse_ok": True,
                "difficulty": "medium",
                "tags": ["ambiguous"],
                "has_visible_report": True,
            }
        ]
    )

    assert rows[0]["vars"]["predicted_json"] == '{"action":"rewrite_report"}'
    assert rows[0]["metadata"]["has_visible_report"] is True
