"""Tests for prompt-tag normalization, ported from the TS `normalizePromptTags`
(lib/library/services/metadata-service.ts) + `prompt-tags.ts`."""
from prompt_tags import normalize_prompt_tags


def test_empty_returns_empty():
    assert normalize_prompt_tags(None) == []
    assert normalize_prompt_tags("") == []


def test_basic_comma_split_and_lowercase_dedupe():
    assert normalize_prompt_tags("Masterpiece, best quality, Masterpiece") == [
        "masterpiece",
        "best quality",
    ]


def test_emphasis_weights_dropped():
    # `tag:0.65` -> emphasis weight stripped
    assert normalize_prompt_tags("(masterpiece:1.2), best quality:0.65") == [
        "masterpiece",
        "best quality",
    ]


def test_balanced_brackets_unwrapped():
    assert normalize_prompt_tags("((detailed)), [soft light]") == [
        "detailed",
        "soft light",
    ]


def test_parenthetical_booru_tag_preserved():
    # legitimate parenthetical tag must survive
    assert normalize_prompt_tags("taimanin (series)") == ["taimanin (series)"]


def test_break_and_newline_separators():
    assert normalize_prompt_tags("a BREAK b\nc") == ["a", "b", "c"]


def test_stop_tokens_filtered():
    assert normalize_prompt_tags("a, BREAK, and, lora, embedding, b") == ["a", "b"]


def test_loras_stripped():
    assert normalize_prompt_tags("<lora:foo:0.8> girl, smile") == ["girl", "smile"]


def test_long_token_dropped():
    long = "x" * 81
    assert normalize_prompt_tags(f"ok, {long}") == ["ok"]


def test_backslash_escapes_removed():
    assert normalize_prompt_tags(r"\(scared\)") == ["scared"]


def test_unbalanced_stray_bracket_trimmed():
    # weighted group spanning commas leaves a stray bracket
    assert normalize_prompt_tags("((a:0.9), (b))") == ["a", "b"]
