from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from dataforge.core.registry import TaskConfig


class GeneratorProvider(ABC):
    @abstractmethod
    def generate_samples(self, task: TaskConfig, scenarios: list[dict[str, Any]]) -> list[dict[str, Any]]:
        raise NotImplementedError


class TeacherProvider(ABC):
    @abstractmethod
    def classify_sample(self, task: TaskConfig, sample: dict[str, Any]) -> tuple[bool, str | None, str, str | None]:
        raise NotImplementedError


class EvalProvider(ABC):
    @abstractmethod
    def predict_sample(self, task: TaskConfig, sample: dict[str, Any]) -> tuple[bool, str | None, str, str | None]:
        raise NotImplementedError
