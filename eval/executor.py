#!/usr/bin/env python3
"""
Sandbox executor for benchmark evaluation.

Combines generated code with test code and runs them in an isolated
subprocess with a configurable timeout.

Usage:
    python3 executor.py --code code.py --test test.py [--timeout 5]

Output: JSON on stdout
    {"passed": bool, "stdout": str, "stderr": str, "returncode": int}
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark code executor")
    parser.add_argument("--code", required=True, help="Path to generated code file")
    parser.add_argument("--test", required=True, help="Path to test code file")
    parser.add_argument("--timeout", type=int, default=5, help="Timeout in seconds")
    args = parser.parse_args()

    # Read inputs
    with open(args.code, "r") as f:
        code = f.read()
    with open(args.test, "r") as f:
        test = f.read()

    # Combine: generated code first, then test harness
    combined = code + "\n\n" + test

    # Write combined to a temp file
    fd, tmppath = tempfile.mkstemp(suffix=".py", prefix="bench_")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(combined)

        # Execute in a subprocess with timeout
        result = subprocess.run(
            [sys.executable, tmppath],
            capture_output=True,
            text=True,
            timeout=args.timeout,
            env={
                **os.environ,
                "PYTHONDONTWRITEBYTECODE": "1",
                "PYTHONHASHSEED": "0",
            },
        )

        json.dump(
            {
                "passed": result.returncode == 0,
                "stdout": result.stdout[:4000],
                "stderr": result.stderr[:4000],
                "returncode": result.returncode,
            },
            sys.stdout,
        )

    except subprocess.TimeoutExpired:
        json.dump(
            {
                "passed": False,
                "stdout": "",
                "stderr": f"Timeout: exceeded {args.timeout}s limit",
                "returncode": -1,
            },
            sys.stdout,
        )

    finally:
        try:
            os.unlink(tmppath)
        except OSError:
            pass


if __name__ == "__main__":
    main()
