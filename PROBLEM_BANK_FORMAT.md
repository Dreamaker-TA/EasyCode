# Problem Bank Format

EasyCode does not ship a full problem bank. A clean checkout includes only the tiny example bank under `examples/problem-bank/`. Put your own bank outside the application repository and point EasyCode at it.

## Preferred Creation Flow

Use these paths in order:

1. **Project skill (recommended):** From the EasyCode repository root, use `$create-easycode-problem-bank` in Codex or `/create-easycode-problem-bank` in Claude Code. The skill creates and validates a complete entry from an exercise brief. Its files are in [`.agents/skills/`](.agents/skills/create-easycode-problem-bank/SKILL.md) and [`.claude/skills/`](.claude/skills/create-easycode-problem-bank/SKILL.md).
2. **Any AI assistant:** Use the [JSON prompt](#prompt-for-another-ai-assistant), then pass its response to `make problem-entry-check` and `make problem-entry`.
3. **Manual files:** Use the directory, Markdown, test, and rubric references below only when you want to maintain each file yourself.

## Directory Layout

```text
my-bank/
└─ Code/
   └─ 01_basics/
      ├─ 01_1001_two-sum.md
      ├─ 01_1001_two-sum.tests.json
      └─ 01_1001_two-sum.rubric.md
```

`Code/` is required. Chapter directories can use any readable name; a numeric prefix such as `01_基础` or `01_basics` keeps ordering stable.

## Problem Markdown

Each problem is a Markdown file under `Code/**/*.md`. A matching `.rubric.md` file holds optional grading criteria; it is not a standalone problem.

Required structure:

```markdown
# 1001. Two Sum ★

## 题目描述

Describe the input, output, examples, and constraints.

## 解题思路

Optional reference explanation. This section and everything after it is treated
as reference material for review/tutor prompts, not as the public statement.

## Python 代码

Optional reference implementation.
```

Rules:

- The first `#` heading should use the standard LeetCode-style numeric format `# <id>. <title> [★]`. A trailing `★` marks the problem as core.
- `## 题目描述` is required. Files without it are not imported.
- The public statement is `## 题目描述` up to the next `##` heading.
- The reference solution is everything after the next `##` heading.
- If a problem has no reference solution, it can still be listed, but the AI review may be less reliable.

Recommended title pattern:

```markdown
# 1001. Two Sum ★
```

For original exercises, assign a stable numeric ID in the same style whenever possible. A plain `# Problem Title ★` heading is accepted when you do not have a stable numeric ID yet, but platform-prefixed or mixed numbering styles are not recommended.

## Optional Grading-Criteria File

Add an optional file next to the problem:

```text
01_1001_two-sum.rubric.md
```

Write short grading criteria, one bullet per criterion:

```markdown
- Reads exactly two integers and outputs their sum.
- Does not print extra prompt text.
- Runs in O(1) time and O(1) space.
```

After `make ingest`, these criteria guide the AI review.

## Optional Test File

Add an optional `.tests.json` file next to the problem:

```json
{
  "version": 1,
  "time_limit_ms": 1000,
  "memory_limit_mb": 128,
  "checker": "token",
  "cases": [
    {
      "id": "sample-1",
      "is_sample": true,
      "stdin": "2 3\n",
      "expected_stdout": "5\n",
      "note": "positive integers"
    },
    {
      "id": "hidden-1",
      "is_sample": false,
      "stdin": "-7 4\n",
      "expected_stdout": "-3\n",
      "note": "negative input"
    }
  ],
  "templates": {
    "python": "import sys\n\n\ndef solve(a: int, b: int) -> int:\n    pass\n\n\ndef main() -> None:\n    a, b = map(int, sys.stdin.read().split())\n    print(solve(a, b))\n\n\nif __name__ == \"__main__\":\n    main()\n"
  }
}
```

Fields:

- `version`: use `1`.
- `time_limit_ms`: per-case time limit.
- `memory_limit_mb`: informational memory limit.
- `checker`: `token`, `exact`, `float`, or the reserved `custom` value. `token` is the safest default.
- `cases`: at least one case. `id` must be unique inside the file.
- `is_sample`: sample cases are shown in the app; hidden cases are used when running the full test set before or during submission.
- `stdin` and `expected_stdout`: exact program input and expected output.
- `templates.python`: optional starter code for LeetCode-style mode.

Checker behavior:

- `token`: trims and normalizes whitespace between tokens.
- `exact`: compares output after trimming trailing spaces and final blank lines.
- `float`: compares numeric tokens with a small tolerance.
- `custom`: reserved for future/custom integrations and currently falls back to token behavior. The bundled problem generators intentionally reject it.

## Import And Run

Source development:

```bash
EASYCODE_PROBLEM_BANK_ROOT=/absolute/path/to/my-bank make ingest
make dev
```

Docker:

```bash
PROBLEM_BANK_HOST_PATH=/absolute/path/to/my-bank docker compose up --build
```

The `make ingest` command writes `backend/data/problems.json` and adds the problems to the local database. Both are generated while the app runs and should not be committed.

## Optional Configured-Model Shortcut

When `.env` contains a working OpenAI-compatible model configuration, this
interactive shortcut can create an entry without leaving the terminal:

```bash
make problem-generate BANK_ROOT=/absolute/path/to/my-bank
EASYCODE_PROBLEM_BANK_ROOT=/absolute/path/to/my-bank make ingest
```

The command asks for a plain-language exercise description, requests one
JSON description from the model, validates every sample and hidden input by
running the reference Python program, previews the output paths, and asks before
writing. Existing files are never overwritten.

For non-interactive automation, put the description in a UTF-8 file and run:

```bash
cd backend
uv run python ../scripts/generate_problem.py \
  --bank-root /absolute/path/to/my-bank \
  --request-file /absolute/path/to/request.txt \
  --write --yes
```

## Create Problem Files from an AI-Generated JSON Description

If you cannot use the project skill, ask an AI assistant for one JSON description
and let EasyCode write the three bank files:

```bash
make problem-entry-check BANK_ROOT=/absolute/path/to/my-bank SPEC=/absolute/path/to/problem.json
make problem-entry BANK_ROOT=/absolute/path/to/my-bank SPEC=/absolute/path/to/problem.json
EASYCODE_PROBLEM_BANK_ROOT=/absolute/path/to/my-bank make ingest
```

`problem-entry-check` previews and validates without writing files. `problem-entry` writes:

- the Markdown problem file
- the `.tests.json` test file
- the `.rubric.md` grading-criteria file

The tool runs the reference Python program against every sample case and
fails if any sample output does not match. It then runs the same reference
program on hidden inputs to generate `expected_stdout`, which avoids trusting
AI-generated hidden answers.

Illustrative field shape (replace every placeholder with runnable code and real,
distinct inputs before passing it to the tool):

```json
{
  "source_path": "Code/01_basics/01_1002_balance-score.md",
  "id": 1002,
  "title": "Balance Score",
  "core": true,
  "statement_md": "Public statement, examples, input/output format, and constraints.",
  "explanation_md": "Reference explanation.",
  "template": "import sys\n\n\ndef solve(...):\n    pass\n\n\nif __name__ == \"__main__\":\n    ...\n",
  "reference": "import sys\n\n\ndef solve(...):\n    ...\n\n\nif __name__ == \"__main__\":\n    ...\n",
  "checker": "token",
  "time_limit_ms": 1000,
  "memory_limit_mb": 128,
  "samples": [
    {"stdin": "sample input 1\n", "expected": "sample output 1\n", "note": "first sample"},
    {"stdin": "sample input 2\n", "expected": "sample output 2\n", "note": "second sample"}
  ],
  "hidden": [
    {"stdin": "edge input 1\n", "note": "small boundary"},
    {"stdin": "edge input 2\n", "note": "large boundary"},
    {"stdin": "edge input 3\n", "note": "mixed values"}
  ],
  "rubric": [
    "Parses input exactly as specified.",
    "Handles the stated edge cases.",
    "Fits the expected time and space complexity."
  ]
}
```

### Prompt for Another AI Assistant

You can give the following prompt to an AI assistant. Replace the bracketed parts
with your own topic and constraints.

```text
Create an EasyCode JSON problem description for an original programming exercise.

Output exactly one JSON object, with no Markdown fences and no extra prose.

Requirements:
- Use this directory style: Code/01_basics/01_1001_problem-title.md.
- Use "source_path" for that relative Markdown path.
- Include "id", "title", and "core".
- Use the standard LeetCode-style numeric title format "# <id>. <title> [★]" whenever possible; avoid platform prefixes and mixed numbering styles.
- Put the public statement, examples, input/output format, and constraints in "statement_md".
- Use `###` headings inside "statement_md"; `##` headings are reserved for EasyCode's public/reference split.
- Put the explanation in "explanation_md".
- Include a complete runnable Python starter program in "template".
- Include a complete runnable Python reference program in "reference".
- Use checker="token" unless exact formatting or floating-point tolerance matters.
- Include at least 2 sample cases in "samples"; each sample must have "stdin", "expected", and "note".
- Include at least 3 hidden cases in "hidden"; each hidden case needs "stdin" and may include "note".
- Include 3-6 concise grading bullets in "rubric".
- Ensure the reference program really produces every sample "expected" output.
```

After generation, run:

```bash
make problem-entry-check BANK_ROOT=/absolute/path/to/my-bank SPEC=/absolute/path/to/problem.json
make problem-entry BANK_ROOT=/absolute/path/to/my-bank SPEC=/absolute/path/to/problem.json
EASYCODE_PROBLEM_BANK_ROOT=/absolute/path/to/my-bank make ingest
```

Fix any import errors before running `make ingest`.
