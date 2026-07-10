"""相邻快照 → unified diff 工具。

LLM 评测时,我们把过程时间线渲染成"首帧完整代码 + 后续帧相对上一帧的 diff",
让 LLM 真正看到"在什么时刻改了什么",而不只是 hash 变化。
"""

from __future__ import annotations

import difflib

_DIFF_MAX_BYTES = 4096


def unified_diff(prev: str, curr: str, n_context: int = 2) -> str:
    """返回 prev → curr 的 unified diff 正文(不含 file header)。

    - 完全相同返回 `(no change)`
    - diff 文本 UTF-8 字节数超过 _DIFF_MAX_BYTES 时按行截断,末尾追加 `... [+N more lines]`
    """
    if prev == curr:
        return "(no change)"

    raw = list(
        difflib.unified_diff(
            prev.splitlines(),
            curr.splitlines(),
            n=n_context,
            lineterm="",
        )
    )
    # difflib 输出会带 "--- "/"+++ " 两行 file header,这里去掉。
    if raw and raw[0].startswith("--- ") and len(raw) >= 2 and raw[1].startswith("+++ "):
        raw = raw[2:]
    if not raw:
        return "(no change)"

    text = "\n".join(raw)
    if len(text.encode("utf-8")) <= _DIFF_MAX_BYTES:
        return text

    # 超长:按行累加直到逼近 byte 上限,末尾标注省略
    kept: list[str] = []
    used = 0
    for line in raw:
        line_bytes = len(line.encode("utf-8")) + 1  # +1 for newline
        if used + line_bytes > _DIFF_MAX_BYTES:
            break
        kept.append(line)
        used += line_bytes
    omitted = len(raw) - len(kept)
    if omitted > 0:
        kept.append(f"... [+{omitted} more lines]")
    return "\n".join(kept)
