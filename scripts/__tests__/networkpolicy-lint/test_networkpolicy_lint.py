#!/usr/bin/env python3
"""
Negative control for check-networkpolicy-ports.py.

WHY THIS EXISTS
===============
The lint guards a real outage: on 2026-05-04 status.enclii.dev went down four
times because a NetworkPolicy permitted port 80 while the pods it selected
exposed 8000. Cloudflared connected, the CNI silently dropped the traffic, and
diagnosis took hours because there were no log entries anywhere.

The lint has run in CI across several repos ever since and has never been seen
to fail. That is not evidence it works — it is the absence of evidence either
way, and it is exactly the shape of every defect found on 2026-07-31: the PSP
gate that failed *because the repository was clean*, the E2E job skipped for
days behind a green-looking gate, the billing suite whose four assertions
"pass identically in a world where NO signature can ever be accepted."

So this suite plants violations and requires the lint to catch them. If
detection silently breaks — a mangled selector resolver, a swallowed parse
error, a refactor that stops walking ingress rules — these tests go red instead
of every repo's NetworkPolicy job going quietly green while protecting nothing.

IT ALSO GUARDS THE OTHER DIRECTION
==================================
`egress-only` and `no-ports` must PASS. A lint that flagged those would be
over-eager, and an over-eager gate gets disabled — which is a slower path to
the same unprotected state. Egress `ports:` describe the *destination* (DNS 53,
HTTPS 443) and have no relationship to the source pod's containerPorts;
omitting `ports:` entirely is the incident-level fix, not a violation.

Run:
    python3 -m unittest discover -s scripts/__tests__/networkpolicy-lint -p 'test_*.py' -v
"""

import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
LINT = HERE.parent.parent / "check-networkpolicy-ports.py"


def run_lint(fixture: str) -> subprocess.CompletedProcess:
    """Run the lint against one fixture directory, as CI does."""
    return subprocess.run(
        [sys.executable, str(LINT), str(HERE / fixture)],
        capture_output=True,
        text=True,
    )


class TestLintDetectsViolations(unittest.TestCase):
    """The gate must be able to fail. These are the planted violations."""

    def test_numeric_port_mismatch_is_caught(self):
        """The 2026-05-04 outage itself: policy permits 80, pod exposes 8000."""
        result = run_lint("numeric-mismatch")
        self.assertEqual(
            result.returncode,
            1,
            "The lint did NOT catch a policy permitting port 80 against pods "
            "exposing 8000 — the exact bug it exists to prevent. Detection is "
            f"broken.\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    def test_named_port_mismatch_is_caught(self):
        """A named port that does not exist on the selected pods."""
        result = run_lint("named-mismatch")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_match_expressions_selector_is_resolved(self):
        """
        A resolver that only understood matchLabels would silently skip this
        policy and report success — a false green rather than a miss, which is
        strictly worse because it looks like coverage.
        """
        result = run_lint("match-expressions")
        self.assertEqual(
            result.returncode,
            1,
            "A matchExpressions podSelector with a port mismatch was not "
            "caught. The selector resolver is not walking matchExpressions, so "
            "every policy using them is unchecked while reporting OK.\n"
            f"stdout:\n{result.stdout}",
        )

    def test_failure_output_names_the_offending_file(self):
        """
        A gate that fails without saying where is a gate people learn to
        ignore. The 2026-05-04 diagnosis took hours precisely because nothing
        pointed at the cause.
        """
        result = run_lint("numeric-mismatch")
        combined = result.stdout + result.stderr
        self.assertIn("manifests.yaml", combined)
        self.assertIn("allow-cloudflared-ingress", combined)


class TestLintAcceptsValidManifests(unittest.TestCase):
    """
    The gate must also be able to pass. An over-eager lint gets switched off,
    which reaches the same unprotected state by a slower route.
    """

    def test_intersecting_ports_pass(self):
        result = run_lint("clean")
        self.assertEqual(
            result.returncode, 0, result.stdout + result.stderr
        )

    def test_egress_ports_are_not_checked(self):
        """
        Egress `ports:` are the destination port — DNS 53, HTTPS 443 — and have
        no relationship to the source pod's containerPorts. Flagging these
        would make the lint unusable on every workload that talks to anything.
        """
        result = run_lint("egress-only")
        self.assertEqual(
            result.returncode,
            0,
            "The lint flagged an egress port block. Egress ports describe the "
            "destination, not the source pod, so this is a false positive.\n"
            f"stdout:\n{result.stdout}",
        )

    def test_policies_without_ports_pass(self):
        """
        Omitting `ports:` is the incident-level fix — cloudflared is the trust
        boundary and the per-port restriction adds no security, only a failure
        mode. The lint must not push people away from it.
        """
        result = run_lint("no-ports")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class TestHarnessIntegrity(unittest.TestCase):
    """
    Guards against this suite passing for the wrong reason. If the lint script
    goes missing or stops being executable, every test above would report a
    non-zero exit and the violation tests would "pass" while measuring nothing.
    """

    def test_lint_script_exists(self):
        self.assertTrue(LINT.is_file(), f"lint script not found at {LINT}")

    def test_clean_and_violating_fixtures_disagree(self):
        """
        The load-bearing assertion of the whole file: a clean tree and a
        violating tree must produce DIFFERENT exit codes. If they ever agree,
        the lint is either always-pass or always-fail, and every other
        assertion here is decoration.
        """
        clean = run_lint("clean").returncode
        violating = run_lint("numeric-mismatch").returncode
        self.assertNotEqual(
            clean,
            violating,
            "Clean and violating fixtures produced the same exit code "
            f"({clean}). The lint is not discriminating between them, so it is "
            "measuring nothing regardless of what the other tests report.",
        )


if __name__ == "__main__":
    unittest.main()
