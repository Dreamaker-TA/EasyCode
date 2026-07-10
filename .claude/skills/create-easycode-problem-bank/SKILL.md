---
name: create-easycode-problem-bank
description: Create a validated EasyCode problem-bank entry from a programming-exercise brief or JSON spec. Use when a user asks to add, generate, scaffold, or expand an EasyCode coding problem with its Markdown statement, Python tests, and grading rubric. Do not use for app-code changes, importing an existing bank, or editing a problem without the user's request.
---

# Create an EasyCode problem-bank entry

Use EasyCode's existing JSON-entry helper; do not hand-write the three output files.

## Set the scope

- Work from an EasyCode checkout containing `Makefile`, `scripts/create_problem_entry.py`, and `PROBLEM_BANK_FORMAT.md`.
- Require a `BANK_ROOT`. If the user has not provided one, ask for it before writing. Default to a bank outside the application repository; do not change `examples/problem-bank/` unless the user explicitly asks to edit the fixture.
- For a new bank, use `Code/<chapter>/` beneath `BANK_ROOT`. The helper creates missing directories.
- For an existing bank, inspect its `Code/**/*.md` files before choosing a chapter, file sequence, or numeric ID. Do not reuse an existing ID or overwrite a file.

## Build the JSON spec

If the user provides a valid JSON spec, use it. Otherwise, turn the exercise brief into one JSON object with these fields:

- `source_path`: a safe relative path such as `Code/01_basics/01_1001_two-sum.md`
- `id`, `title`, and `core`
- `statement_md` and `explanation_md`
- complete runnable Python `template` and `reference` programs
- `samples`, `hidden`, and `rubric`

Keep `##` headings out of `statement_md`; use `###` for subsections. Include at least two distinct sample cases, at least three distinct hidden cases, and three to six rubric items. Use `checker: "token"` unless exact or floating-point comparison is necessary. Do not invent expected output: the helper derives hidden outputs from `reference` and verifies every sample.

Read `PROBLEM_BANK_FORMAT.md` if the request needs the full schema or a non-default checker. Ask a concise clarification only when the brief lacks information needed to make a safe exercise, such as the intended input/output behavior or constraints.

## Validate, then write

1. Save the spec to a temporary JSON file outside `BANK_ROOT`.
2. From the EasyCode repository root, run:

   ```bash
   make problem-entry-check BANK_ROOT="/absolute/path/to/my-bank" SPEC="/absolute/path/to/problem.json"
   ```

3. Fix every validation error. If the dry run reports existing files, stop and ask before replacing anything; never add `--force` without explicit approval.
4. Write only after a successful check:

   ```bash
   make problem-entry BANK_ROOT="/absolute/path/to/my-bank" SPEC="/absolute/path/to/problem.json"
   ```

5. Report the three created paths. Run `EASYCODE_PROBLEM_BANK_ROOT="..." make ingest` only when the user also asks to import the bank into the application, because it changes local application data.
