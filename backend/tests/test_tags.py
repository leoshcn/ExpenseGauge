"""The tag syntax (`app/tags.py`); the frontend's parser reads the same vectors."""

import json
from pathlib import Path

import pytest

from app.tags import is_valid_tag, parse_tags, replace_tag

VECTORS = json.loads((Path(__file__).parent / "tag_vectors.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("vector", VECTORS, ids=lambda vector: repr(vector["note"]))
def test_parse_tags(vector):
    assert parse_tags(vector["note"]) == vector["tags"]


def test_replace_tag_touches_whole_tags_only():
    note = "#国庆 #国庆2026 ##国庆 国庆 #国庆，好"
    assert replace_tag(note, "国庆", "假期") == "#假期 #国庆2026 ##国庆 国庆 #假期，好"


def test_is_valid_tag():
    assert is_valid_tag("国庆2026")
    assert is_valid_tag("a" * 50)
    assert not is_valid_tag("a" * 51)
    for name in ["", "两 词", "a#b", "a，b"]:
        assert not is_valid_tag(name)
