from __future__ import annotations

import json
from typing import Any

from dataforge.core.registry import TaskConfig
from dataforge.providers.base import EvalProvider, GeneratorProvider, TeacherProvider


class MockGeneratorProvider(GeneratorProvider):
    def generate_samples(self, task: TaskConfig, scenarios: list[dict[str, Any]]) -> list[dict[str, Any]]:
        samples: list[dict[str, Any]] = []
        counter = 1
        for scenario in scenarios:
            context = scenario["context"]
            for utterance in scenario.get("templates", []):
                samples.append(
                    {
                        "id": f"{task.name}-{counter:06d}",
                        "task_name": task.name,
                        "theme": task.config["theme"],
                        "stage": "candidate",
                        "context": context,
                        "input": {"user_text": utterance},
                        "metadata": {
                            "source": "synthetic",
                            "difficulty": scenario["difficulty"],
                            "tags": scenario.get("tags", []),
                            "label_hint": scenario["intent"],
                        },
                    }
                )
                counter += 1
        return samples


def _classify_with_mock_rules(sample: dict[str, Any]) -> tuple[bool, str | None, str, str | None]:
    text = sample["input"]["user_text"]
    hint = sample.get("metadata", {}).get("label_hint")
    if "bad-json" in sample.get("metadata", {}).get("tags", []):
        return False, None, text, "invalid_teacher_output"

    predicted = hint
    lowered = text.lower()
    if any(token in lowered for token in ("重跑", "重新分析", "最新信息", "再出一版")):
        predicted = "regenerate_report"
    elif any(token in lowered for token in ("改得", "润色", "正式一点", "重写", "汇报")):
        predicted = "rewrite_report"
    elif any(token in lowered for token in ("什么意思", "解释一下", "为什么")):
        predicted = "chat"

    raw_output = json.dumps({"action": predicted}, ensure_ascii=False)
    return True, predicted, raw_output, None


class MockTeacherProvider(TeacherProvider):
    def classify_sample(self, task: TaskConfig, sample: dict[str, Any]) -> tuple[bool, str | None, str, str | None]:
        return _classify_with_mock_rules(sample)


class MockEvalProvider(EvalProvider):
    def predict_sample(self, task: TaskConfig, sample: dict[str, Any]) -> tuple[bool, str | None, str, str | None]:
        return _classify_with_mock_rules(sample)
