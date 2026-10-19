---
name: research-experiments
description: Turn an authorized research question into a controlled experiment, run it with the project's existing tools, and interpret the result. Use when an idea needs an experiment; success means a trustworthy answer, including a negative or inconclusive one.
---

# Research Experiments

This is a generic example skill shipped with Mojito; adapt it to your own tools and compute.

Before running anything, recover the question, the idea and sources it belongs to, the results that already exist, and the authorization: how long, on what hardware, with what spending limit. A request to build or discuss a research system does not by itself authorize a new paid experiment.

## Choose the next informative experiment

Work in this order: check that the effect is real, check that the measurement can be trusted, find the layer where it lives, and only then change something. State the competing explanations and the observation that would tell them apart.

Write down before seeing any outcome, in the project's existing plan:

- the hypothesis and its rivals;
- the one variable you control, and what is held fixed;
- the baselines, and why they are comparable (same data, same budget, same exposure: for training runs compare the tokens that actually carry loss, not sample counts);
- the effect size that would matter, the noise you expect (seeds, sampling) and how many runs that needs;
- the interpretation rule: which result supports, refutes or leaves the question open.

An underpowered test is inconclusive. A small pilot screens a wider claim; claims about scale or transfer need their own evidence. Analyses you think of after seeing the results are exploratory: label them and confirm them separately.

## Run it through the existing path

- Use the project's real entry point and launcher. Write new code only when it directly serves this experiment; do not build another generic runner.
- Do a one-item smoke run through the real dependencies first, and confirm the new mechanism actually fired (the expected events appear in the records, not merely "no error").
- Run inside the authorized envelope. Keep the commit, configuration, data selection, raw outputs and usage needed to reproduce the comparison.
- Engineering failures get fixed and resumed within budget. A changed scientific criterion starts a new, clearly labeled comparison.
- Release the hardware when the run ends.

## Interpret and write back

Classify every outcome as **supported**, **refuted**, **inconclusive** or **invalid** (the measurement or the execution was broken). Invalid runs are never evidence. A trustworthy negative answer is a finished experiment.

Never tune, re-run or stop early until a positive or significant result appears; follow the analysis you wrote down. Report progress in one sentence: relative to the previous comparison, which controlled variable changed and which measured result moved. If you cannot write that sentence honestly, say the change is not attributable.

Write the result into the idea's evidence (Idea Lab, through [Research Ideas](../research-idea-funnel/SKILL.md)) and pick the next step from the uncertainty that remains. Before the result enters a paper, get it checked with [Research Review](../research-review/SKILL.md).
