from __future__ import annotations

import argparse
from pathlib import Path

from dataforge.core.env import load_dotenv
from dataforge.core.registry import load_task_config, resolve_task_run
from dataforge.pipelines import build_gold, classify, eval as eval_pipeline, filter_export, generate, review_export, validate_review


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DataForge MVP CLI")
    parser.add_argument(
        "command",
        choices=["generate", "classify", "filter-export", "review-export", "validate-review", "build-gold", "eval", "run-all"],
    )
    parser.add_argument("--task", required=True)
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--run-id")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    project_root = Path(args.project_root).resolve()
    load_dotenv(project_root / ".env")
    task = load_task_config(project_root, args.task)
    task_run = resolve_task_run(task, command=args.command, run_id=args.run_id)

    if args.command == "generate":
        generate.run(task_run)
    elif args.command == "classify":
        classify.run(task_run)
    elif args.command == "filter-export":
        filter_export.run(task_run)
    elif args.command == "review-export":
        review_export.run(task_run)
    elif args.command == "validate-review":
        validate_review.run(task_run)
    elif args.command == "build-gold":
        build_gold.run(task_run)
    elif args.command == "eval":
        eval_pipeline.run(task_run)
    elif args.command == "run-all":
        generate.run(task_run)
        classify.run(task_run)
        filter_export.run(task_run)
        review_export.run(task_run)


if __name__ == "__main__":
    main()
