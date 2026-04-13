# cmdr Benchmark Evaluation

Self-contained benchmarking harness for evaluating cmdr's code generation
against **HumanEval** and **MBPP** benchmarks.

## Directory Structure

```
eval/
├── datasets/
│   ├── humaneval.jsonl      # HumanEval tasks (JSONL)
│   └── mbpp.jsonl           # MBPP tasks (JSONL)
├── runs/
│   ├── humaneval/           # Per-task logs for HumanEval
│   └── mbpp/                # Per-task logs for MBPP
├── results/
│   ├── humaneval_results.json
│   └── mbpp_results.json
├── runner.ts                # Main benchmark runner
├── executor.py              # Python sandbox executor
├── utils.ts                 # Dataset loading & code extraction
└── README.md
```

## Prerequisites

- **Node.js ≥ 20** with `npx` available
- **Python 3.8+** (used by `executor.py` for sandboxing)
- **Ollama** running locally with a model pulled
- **tsx** (`npx tsx` — bundled with Node.js, no install needed)

## Setup

1. **Start Ollama** (if not already running):
   ```bash
   ollama serve
   ```

2. **Pull a model** (if not already available):
   ```bash
   ollama pull qwen3-coder:latest
   ```

3. **Prepare datasets**:
   The `datasets/` folder ships with 5 sample tasks per benchmark for
   testing the harness. To run against the full benchmarks:

   - **HumanEval** (164 tasks): Download from the
     [OpenAI HumanEval repository](https://github.com/openai/human-eval)
     and place the JSONL file at `eval/datasets/humaneval.jsonl`.
   - **MBPP** (974 tasks): Download from the
     [Google MBPP repository](https://github.com/google-research/google-research/tree/master/mbpp)
     and convert to JSONL format at `eval/datasets/mbpp.jsonl`.

   Each HumanEval line must have:
   ```json
   {"task_id": "HumanEval/0", "prompt": "...", "entry_point": "...", "canonical_solution": "...", "test": "..."}
   ```

   Each MBPP line must have:
   ```json
   {"task_id": 1, "text": "...", "code": "...", "test_list": ["assert ..."], "test_setup_code": ""}
   ```

## Running Benchmarks

### HumanEval

```bash
npx tsx eval/runner.ts --benchmark humaneval --model qwen3-coder:latest
```

### MBPP

```bash
npx tsx eval/runner.ts --benchmark mbpp --model qwen3-coder:latest
```

### Quick Test (first N tasks)

```bash
npx tsx eval/runner.ts --benchmark humaneval --model qwen3-coder:latest --limit 3
```

## CLI Options

| Flag                | Short | Default                  | Description                        |
|---------------------|-------|--------------------------|------------------------------------|
| `--benchmark <name>`| `-b`  | `humaneval`              | Benchmark to run (`humaneval`/`mbpp`) |
| `--model <name>`    | `-m`  | `qwen3-coder:latest`    | Ollama model name                  |
| `--ollama-url <url>`| `-u`  | `http://localhost:11434` | Ollama API URL                     |
| `--limit <n>`       | `-l`  | `0` (all)                | Max tasks to evaluate              |
| `--timeout <sec>`   | `-t`  | `5`                      | Per-task execution timeout (sec)   |
| `--retries <n>`     | `-r`  | `1`                      | Retries per task on failure        |

## How It Works

### Pipeline

For each task in the benchmark:

1. **Prompt** — Build a code-completion prompt from the task definition
2. **Generate** — Call Ollama API (`temperature=0`, single shot, no tools)
3. **Extract** — Parse Python code from the LLM response
4. **Validate** — Check syntax via `ast.parse()`
5. **Execute** — Combine code + tests, run in sandboxed subprocess
6. **Record** — Store pass/fail, timing, raw output, and extracted code

### Code Extraction Strategy

The extractor tries three methods in order:
1. Fenced ` ```python ` blocks (preferred)
2. Generic ` ``` ` blocks
3. Heuristic line-by-line scan for Python keywords
4. Fallback: stripped raw output

### Execution Sandbox

`executor.py` runs the combined code + test in a separate Python subprocess
with a hard timeout. No network access is needed during execution.

## Understanding pass@1

**pass@1** is the fraction of tasks where the model produces a correct
solution on the first attempt:

$$
\text{pass@1} = \frac{\text{tasks passed}}{\text{total tasks}}
$$

With `temperature=0` and a single attempt, this measures the model's
greedy decoding accuracy — the most deterministic evaluation setting.

## Output

### Results File

`results/<benchmark>_results.json` contains:

```json
{
  "benchmark": "humaneval",
  "model": "qwen3-coder:latest",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "total": 164,
  "passed": 52,
  "pass@1": 0.317,
  "results": [
    {
      "task_id": "HumanEval/0",
      "passed": true,
      "duration_ms": 2340,
      "raw_output": "...",
      "extracted_code": "..."
    }
  ]
}
```

### Per-Task Logs

`runs/<benchmark>/<task_id>.txt` contains the raw model output and extracted
code for each task, useful for debugging failures.

## Known Limitations

- **Single-shot only**: Evaluates greedy decoding (temperature=0).
  Does not compute pass@k for k > 1.
- **No tool use**: The model generates code without access to cmdr's
  tools (file read/write, shell, etc.). This tests raw generation.
- **Sample datasets**: Ships with 5 tasks per benchmark. Full datasets
  must be downloaded separately.
- **Python only**: Both HumanEval and MBPP are Python benchmarks.
- **Timeout sensitivity**: Complex tasks may need `--timeout` increased.
- **Ollama dependency**: Requires a running Ollama instance.
