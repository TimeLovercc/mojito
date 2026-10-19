---
name: research-idea-funnel
description: Explore new research questions from outside observations and the directions you care about, or develop an existing idea through evidence and small diagnostics. Use for research ideation and idea development; pick Explore or Develop first.
---

# Research Ideas

Find questions worth answering, then look for the evidence that would change your mind about them. Your own taste decides what is important; outside observations (papers, released results, failures people report) supply the pressure; principles help you build and test explanations. A principle is itself a hypothesis, not a filter that every observation must be forced through.

This is a generic example skill shipped with Mojito. Copy it into your own skills folder and rewrite it to match how you work.

## Recover the direction and choose a mode

Read the current directions, the principles on your research map, existing ideas in Idea Lab and the project records involved. Write down the capability or understanding you want, who needs it, what an answer would change, what is out of scope and what budget (time, compute, money) is authorized.

- **Explore** when the task is to find new questions or survey a direction. Rough questions are fine; do not demand a full novelty check or an experiment plan yet.
- **Develop** when an idea already exists and the task is to understand, sharpen or test it. Development can send you back to exploring.

Inbox items (ideas, papers, authors, blogs) are seeds. Keep the source and the reason it was collected. Before opening a new idea, check whether the seed supports, contradicts or extends an existing one. Keep three things apart: what others found, what you suspect, and what you have verified yourself.

## Explore: questions from observations

1. **Start from the direction.** State the capability you are after and why it matters, and keep it in view while you look at narrow examples.
2. **Bring in outside evidence.** Public evaluations and checkpoints, reproducible failures, workarounds practitioners use, results that disagree with each other, open questions in recent papers. A cheap re-analysis of public data can generate a question, not only check one. Note which sources you covered.
3. **Ask before you rank solutions.** What does the observation leave unexplained? Which variables did an existing design tie together? What would a different explanation predict? A workaround is a clue, not proof that a problem is unsolved: check how often it bites and whether ordinary practice already handles it.
4. **Write short sketches.** Observation and source, the question, why the answer matters, plausible explanations, the next useful piece of evidence. Unknowns stay marked as unknown. Never claim originality from incomplete reading.

End the round by naming which questions deserve development and why. If nothing new turned up, say so; do not invent a discovery to fill a card.

## Develop: build a credible contribution

1. **Read the nearest work closely.** Compare the actual problem, setting, method, evidence and claimed contribution. Similar work is a reason to sharpen the idea; a novelty claim fails only when problem, method and contribution all coincide. Cite the exact overlap.
2. **Separate the claim from its explanations.** State the hypothesis and its rivals. A mechanism finding, a better measurement, a design rule and a new method are different contributions; evidence for one does not establish the others.
3. **Pick the next discriminating observation.** Check existing public or project evidence before an expensive run. Validate the measurement, the baseline and the budget, look for shortcuts, then locate the layer where the effect lives. Missing evidence calls for a diagnostic, not an invented explanation.
4. **Run inside the authorized scope** with [Research Experiments](../research-experiments/SKILL.md). Small runs screen claims; claims about scale or transfer need matching evidence. Keep supported, refuted and inconclusive results apart. A clean negative answer completes the experiment.
5. **Review and update** with [Research Review](../research-review/SKILL.md) before a novelty claim or a result goes into a paper. Report what new evidence arrived and which judgment it changed.

Judge importance, novelty, trust in the measurement and feasibility separately. Scores, if anyone wants them, summarize evidence; they are not gates. Starting a formal project, spending beyond the budget or stopping a whole project is your call, not the session's.

## Records

Use the [idea card template](templates/idea-card.md) for a sketch that is growing into an idea. Idea Lab holds the evolving question, its evidence and the next step; the full write-up stays in your own documents, papers in your reference manager, experiment state in the project's repository. Every cited paper needs a verified locator (arXiv or DOI).

## Close the loop: sync to Idea Lab

After each research round, and before a handoff or a final answer, save a new sourced question or a real evidence update to Idea Lab with the [sync tool](references/idea-lab.md) (`scripts/idea_lab.py`). Reuse the returned idea id across sessions, link actual seed ids when they apply, and keep earlier evidence and judgment changes intact: add corrections instead of deleting history. A judgment change must quote the real earlier judgment; if it was only this round's working hypothesis, say so. The tool reports success only after reading the write back.

Idea Lab storage and your document sync are separate: mark the document as synced only after a real write and readback. Missing credentials or a blocked write do not stop the research, but stay visible as pending work. An Idea Lab run started from the app already writes its own structured result; do not start a second writer from inside it.

When the argument is concrete enough for an outline, continue with [Paper Writing](../paper-writing/SKILL.md); results that have not been run stay visible placeholders.
