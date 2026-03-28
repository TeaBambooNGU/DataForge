from dataforge.providers.anthropic_compatible import (
    AnthropicCompatibleEvalProvider,
    AnthropicCompatibleGeneratorProvider,
    AnthropicCompatibleTeacherProvider,
    MiniMaxEvalProvider,
    MiniMaxGeneratorProvider,
    MiniMaxTeacherProvider,
)
from dataforge.providers.base import EvalProvider, GeneratorProvider, TeacherProvider
from dataforge.providers.mock import MockEvalProvider, MockGeneratorProvider, MockTeacherProvider
from dataforge.providers.openai_compatible import (
    OpenAICompatibleEvalProvider,
    OpenAICompatibleGeneratorProvider,
    OpenAICompatibleTeacherProvider,
)


def get_generator_provider(name: str) -> GeneratorProvider:
    if name == "mock":
        return MockGeneratorProvider()
    if name == "openai_compatible":
        return OpenAICompatibleGeneratorProvider()
    if name == "anthropic_compatible":
        return AnthropicCompatibleGeneratorProvider()
    if name == "minimax":
        return MiniMaxGeneratorProvider()
    raise ValueError(f"Unsupported generator provider: {name}")


def get_teacher_provider(name: str) -> TeacherProvider:
    if name == "mock":
        return MockTeacherProvider()
    if name == "openai_compatible":
        return OpenAICompatibleTeacherProvider()
    if name == "anthropic_compatible":
        return AnthropicCompatibleTeacherProvider()
    if name == "minimax":
        return MiniMaxTeacherProvider()
    raise ValueError(f"Unsupported teacher provider: {name}")


def get_eval_provider(name: str) -> EvalProvider:
    if name == "mock":
        return MockEvalProvider()
    if name == "openai_compatible":
        return OpenAICompatibleEvalProvider()
    if name == "anthropic_compatible":
        return AnthropicCompatibleEvalProvider()
    if name == "minimax":
        return MiniMaxEvalProvider()
    raise ValueError(f"Unsupported eval provider: {name}")
