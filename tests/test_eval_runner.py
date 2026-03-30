import subprocess
from pathlib import Path

from dataforge.core.eval_runner import build_promptfoo_runtime_config, export_promptfoo_eval, run_promptfoo_eval
from dataforge.core.io import read_jsonl, read_yaml, write_json, write_yaml


def test_export_promptfoo_eval_writes_promptfoo_test_cases(tmp_path: Path) -> None:
    output_path = tmp_path / "eval_for_promptfoo.jsonl"
    eval_rows = [
        {
            "id": "sample-1",
            "user_text": "帮我改正式一点",
            "expected_label": "rewrite_report",
            "predicted_label": "rewrite_report",
            "parse_ok": True,
            "difficulty": "medium",
            "tags": ["ambiguous"],
            "has_visible_report": True,
        }
    ]

    export_promptfoo_eval(output_path, eval_rows)
    rows = read_jsonl(output_path)

    assert len(rows) == 1
    assert rows[0]["vars"]["predicted_json"] == '{"action":"rewrite_report"}'
    assert rows[0]["vars"]["expected"] == "rewrite_report"
    assert rows[0]["assert"][0]["type"] == "is-json"
    assert rows[0]["assert"][1]["value"] == "JSON.parse(output).action === context.vars.expected"


def test_build_promptfoo_runtime_config_injects_tests_and_strips_dataforge(tmp_path: Path) -> None:
    source_config_path = tmp_path / "promptfoo.yaml"
    tests_path = tmp_path / "eval_for_promptfoo.jsonl"
    output_path = tmp_path / "runtime.yaml"
    write_yaml(
        source_config_path,
        {
            "description": "demo",
            "dataforge": {"command": ["npx", "--yes", "promptfoo@latest"]},
            "providers": ["echo"],
            "prompts": ["{{predicted_json}}"],
            "tests": "file://__DATAFORGE_EVAL_FOR_PROMPTFOO__",
        },
    )

    runtime = build_promptfoo_runtime_config(source_config_path, tests_path, output_path)
    rendered = read_yaml(output_path)

    assert runtime["command"] == ["npx", "--yes", "promptfoo@latest"]
    assert "dataforge" not in rendered
    assert rendered["tests"] == f"file://{tests_path}"


def test_run_promptfoo_eval_uses_runner_and_reads_results(tmp_path: Path) -> None:
    config_path = tmp_path / "config.yaml"
    results_path = tmp_path / "results.json"
    config_path.write_text("description: test\n", encoding="utf-8")

    def fake_runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        assert command[:4] == ["npx", "--yes", "promptfoo@latest", "eval"]
        write_json(results_path, {"summary": {"passRate": 1.0}, "results": []})
        return subprocess.CompletedProcess(command, 0, stdout="promptfoo ok", stderr="")

    summary = run_promptfoo_eval(
        ["npx", "--yes", "promptfoo@latest"],
        config_path,
        results_path,
        cwd=tmp_path,
        runner=fake_runner,
    )

    assert summary["status"] == "ok"
    assert summary["summary"] == {"passRate": 1.0}
    assert summary["stdout"] == "promptfoo ok"
