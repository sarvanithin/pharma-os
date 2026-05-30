# Eval plan

This is a plan, not an implementation. The point: in this domain, eval design is more important than implementation polish, because the bar is "would a regulatory affairs lead trust this output?" not "does the test suite pass?".

Four eval surfaces map onto the four parts of the system that can produce wrong answers.

## 1. Multilingual parsing & extraction

**Question:** Given a mixed-language CSR/IND/patent, does the pipeline correctly classify it, detect the language, and extract the field schema?

**Dataset:** A small, hand-labeled set of ~30 documents — 10 English, 5 French, 5 Italian, 10 Chinese — across the four `doc_type` values we have schemas for (`csr`, `ind`, `patent`, `protocol`). Each labeled with: gold `doc_type`, gold `language`, gold field values, and a verbatim quote per field (for source-anchor scoring).

**Metrics:**
- `doc_type` accuracy (overall + per-language)
- `language` accuracy
- Per-field exact-match and per-field LLM-judge-graded similarity (the latter accounts for normalization, e.g. "240 patients" vs "240 subjects")
- `source_anchor` recall: of gold-quoted spans, what fraction appear (substring) in the model's `source_anchors[].quote`?

**Why it matters here:** the multilingual claim is load-bearing. A French CSR that gets classified `other` and language `en` undermines every downstream feature.

## 2. Citation grounding (RAG)

**Question:** When the data room answers a question, is every claim in the answer actually supported by a cited chunk?

**Dataset:** ~50 (question, gold answer span, source chunk id) triples derived from the labeled documents above. Questions span both single-document lookups ("What was the primary endpoint?") and cross-document synthesis ("Which compounds target JAK1?").

**Metrics:**
- **Citation precision:** fraction of citations [n] in the answer that, when read alone, support the claim they're attached to (LLM-judge on (claim, cited chunk) pairs).
- **Citation recall:** fraction of distinct gold source chunks that appear among the answer's citations.
- **Faithfulness:** does the answer make any claim *not* supported by any cited chunk? (LLM-judge; 0/1 per answer.)
- **Refusal accuracy:** for questions whose answer is genuinely not in the data room, does the answer say so? (Negative-set: 10 questions deliberately not answerable from the corpus.)

**Why it matters here:** in this space, an answer that's 95% correct but 5% fabricated is worse than no answer. Refusal accuracy is the safety floor.

## 3. Agent trajectory quality

**Question:** When a workflow runs, does the sequence of tool calls + intermediate outputs look like what a competent analyst would do, and does the final output match the gold?

**Dataset:** ~20 (workflow_template, inputs, gold outputs) tuples — pick the highest-value templates: `patent_prior_art`, `ind_assembly`, `reg_report`, `tabular_review`, `drug_hypothesis`.

**Metrics:**
- **End-state correctness:** LLM-judge similarity between the final `compose` output and the gold output.
- **Tool-use precision:** of the tool calls the agent made, what fraction were warranted? (Judges on (objective, tool_call.args, tool_call.result) tuples.)
- **Redundancy:** were any tool calls duplicative (same args within a run)? Count and rate.
- **Escalation calibration:** for the `confidence_below` policy steps, plot reported confidence vs. end-state correctness; report Brier score / a reliability diagram. The model is well-calibrated if low-confidence runs are mostly wrong and high-confidence runs are mostly right.

**Why it matters here:** trajectory quality is what Yannick gets paid to make better at scale. Without a trajectory eval, "improving the agent" is vibes.

## 4. Compliance check quality

**Question:** When the compliance evaluator scores a document against ICH E6(R3) or 21 CFR Part 11, do its rule-level verdicts agree with a human auditor?

**Dataset:** ~15 documents with auditor-graded rule outcomes (pass / fail / partial) for each of the seeded rules.

**Metrics:**
- **Per-rule agreement** (Cohen's κ vs the human auditor).
- **Evidence grounding:** does the evidence string the model returned actually appear in the document? (Substring check or LLM-judge.)
- **False-pass rate:** the most dangerous failure mode — rules graded `pass` that an auditor graded `fail`. This should be zero.

## How I'd run these

- A nightly GitHub Action against a dedicated `eval` org in the cloud Supabase project, with golden documents seeded from `tests/eval/fixtures/`.
- Results written to a `eval_runs` table (model, dataset_version, metrics jsonb) so deltas across model swaps and prompt iterations are visible over time.
- A small dashboard view in the app: pick an eval, see per-metric trend, drill into individual failure cases (gold output + actual + diff).
- All eval LLM-judge calls use a separate, stable judge model (e.g. Claude Opus pinned) so judge drift doesn't contaminate scores when the *generation* model changes.

## What's not in this plan, deliberately

- Performance benchmarking (latency, throughput) — important, but a different eval discipline.
- Adversarial / red-team prompts — important, but a domain-specific exercise that should follow the first three above.
- Cost regression — `agent_run_steps.tokens` is already captured; cost per run is one query away. Tracking deltas is mostly an ops dashboard, not an eval.
