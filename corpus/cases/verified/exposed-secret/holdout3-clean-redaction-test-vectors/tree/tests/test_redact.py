"""Regression vectors for security.redact.

Every literal below is a placeholder published in vendor documentation
(AWS "EXAMPLE" pair, all-zero GitHub/OpenAI shapes). They are inputs, never
used to authenticate against anything, and CI asserts they get masked.
"""

import pytest

from security.redact import redact, redact_mapping

VECTORS = [
    ("aws id AKIAIOSFODNN7EXAMPLE", "aws id [REDACTED:aws_access_key_id]"),
    (
        "aws secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "aws secret [REDACTED:aws_secret_access_key]",
    ),
    (
        "token ghp_000000000000000000000000000000000000",
        "token [REDACTED:github_token]",
    ),
    ("bearer sk-000000000000000000000000", "bearer [REDACTED:openai_key]"),
    ("slack xoxb-0000000000-0000000000", "slack [REDACTED:slack_token]"),
]


@pytest.mark.parametrize("raw,expected", VECTORS)
def test_redact_masks_known_shapes(raw, expected):
    assert redact(raw) == expected


def test_redact_mapping_leaves_non_strings_alone():
    record = {"user": "AKIAIOSFODNN7EXAMPLE", "attempts": 3}
    assert redact_mapping(record) == {
        "user": "[REDACTED:aws_access_key_id]",
        "attempts": 3,
    }


def test_ordinary_text_is_untouched():
    assert redact("deploy finished in 41 seconds") == "deploy finished in 41 seconds"
