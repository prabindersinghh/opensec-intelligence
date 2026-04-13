# Benchmarks

[← Back to README](../README.md)

---

All benchmarks run through cmdr's eval harness on local hardware (Ollama). No cloud inference for the custom eval suite.

## Custom Eval Suite

**50 tasks across 4 tiers**

| Model | Pass Rate | Score | Grade |
|---|---|---|---|
| qwen3-coder:latest (14B) | 42/50 (84%) | ~160/197 | **S** |

Grade A at 38/50 (71.6%) after the v1.3.0 system prompt rewrite alone (+8 tasks, +19pp from v1.2). Verify script hardening pushed it to 42/50.

## HumanEval

**164 tasks, pass@1**

| Model | pass@1 | Passed |
|---|---|---|
| minimax-m2.5:cloud | **95.7%** | 157/164 |

---

**Next:** [Architecture →](architecture.md)
