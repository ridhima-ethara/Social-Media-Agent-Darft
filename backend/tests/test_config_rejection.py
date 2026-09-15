"""
`Config._set` — A REJECTED VALUE IS RECORDED, NEVER SILENTLY DEFAULTED.

The rule this protects is stated in `core/config.py`'s own docstring: "A value
that fails validation does not silently become the default: the default is used
*and* the rejection is recorded, so a typo surfaces."

That second half is the whole point and the easy half to lose. Falling back to
the default is correct behaviour; doing it quietly is the defect. An operator who
sets `top_keywords=50` against a maximum of 20 has said something specific, and a
run that silently used 5 while reporting success has told them their instruction
was obeyed when it was discarded — the configuration-fabrication cousin of
inventing evidence.

`Config.used()` is also asserted here because `skill_runs.config_used` is built
from it, and that record is what makes a past run explainable after the knobs
change.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import REGISTRY, Config  # noqa: E402


class TestOutOfRangeIsRejectedNotDefaulted:
    def test_above_maximum_is_rejected_and_recorded(self) -> None:
        # top_keywords is declared minimum=1, maximum=20.
        knob = next(k for k in REGISTRY["validation_agent"] if k.key == "top_keywords")
        assert knob.maximum == 20, "this test is written against maximum=20"

        config = Config("validation_agent", {"top_keywords": 50})

        # The default still applies — the run is not broken by a bad knob.
        assert config["top_keywords"] == knob.default
        # ...but the rejection is on the record, naming the value and the bound.
        assert len(config.rejected) == 1
        assert "top_keywords" in config.rejected[0]
        assert "50" in config.rejected[0]
        assert "20" in config.rejected[0]

    def test_below_minimum_is_rejected_and_recorded(self) -> None:
        config = Config("validation_agent", {"top_keywords": 0})
        assert config["top_keywords"] == 5
        assert len(config.rejected) == 1
        assert "below" in config.rejected[0].lower()

    def test_a_value_in_range_is_accepted_and_nothing_is_recorded(self) -> None:
        config = Config("validation_agent", {"top_keywords": 12})
        assert config["top_keywords"] == 12
        assert config.rejected == []

    def test_wrong_type_is_rejected_and_recorded(self) -> None:
        config = Config("validation_agent", {"top_keywords": "not-a-number"})
        assert config["top_keywords"] == 5
        assert len(config.rejected) == 1
        assert "int" in config.rejected[0]

    def test_an_undeclared_knob_is_rejected_rather_than_absorbed(self) -> None:
        """A typo'd knob name must not be silently carried as if it applied."""
        config = Config("validation_agent", {"top_keywordz": 5})
        assert len(config.rejected) == 1
        assert "not a declared setting" in config.rejected[0]
        with pytest.raises(KeyError):
            _ = config["top_keywordz"]


class TestResolvedConfigStaysReplayable:
    def test_used_reports_every_declared_knob(self) -> None:
        """`skill_runs.config_used` is built from this, so it must be complete."""
        config = Config("validation_agent")
        used = config.used()
        declared = {k.key for k in REGISTRY["validation_agent"]}
        assert set(used) == declared

    def test_used_reflects_an_accepted_override_but_not_a_rejected_one(self) -> None:
        config = Config("validation_agent", {"top_keywords": 12, "reject_threshold": 999})
        used = config.used()
        assert used["top_keywords"] == 12
        # The rejected override must not appear as though it took effect.
        assert used["reject_threshold"] == 40
        assert len(config.rejected) == 1


class TestWeightsAreNeverSilentlyRescaled:
    def test_weights_that_do_not_sum_to_100_are_reported(self) -> None:
        keys = ["volume_weight", "engagement_weight", "velocity_weight", "growth_weight"]
        config = Config("validation_agent", {"volume_weight": 10})
        problem = config.check_weights(keys)
        assert problem is not None
        assert "not 100" in problem

    def test_default_weights_sum_to_100(self) -> None:
        keys = ["volume_weight", "engagement_weight", "velocity_weight", "growth_weight"]
        assert Config("validation_agent").check_weights(keys) is None
