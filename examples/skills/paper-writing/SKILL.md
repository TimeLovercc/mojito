---
name: paper-writing
description: Write and revise a research paper around one central claim and the evidence for it - outline, draft, figures, independent review and revision. Use when drafting, editing or reviewing paper text, or when making numbers consistent across a draft.
---

# Paper Writing

This is a generic example skill shipped with Mojito; replace the conventions with your venue's and your group's.

## 1. Fix the central claim

Write the paper's claim in two sentences before writing any section: what is shown, under which conditions, and why a reader in this area should care. Everything in the paper either supports this claim, bounds it, or goes.

## 2. Map claims to evidence

Make a table before drafting:

| Claim (as it will appear) | Evidence (run, table, figure, citation) | Status |
|---|---|---|
| | | supported / pending run / needs citation |

Results that have not been run stay visible placeholders (`[RESULT PENDING: …]`), never invented numbers. Every citation needs a verified locator (arXiv or DOI) that you actually opened. Every number in the text comes from one source of truth (a results file or table), so it can be checked and updated in one place.

## 3. Outline, then draft

- **Introduction:** the problem, why existing answers fall short (with citations), what this paper shows, the evidence in one paragraph, the contributions as a short list that matches the claim table.
- **Method or setup:** enough to reproduce: data, models, budgets, baselines and why they are comparable.
- **Results:** one subsection per claim, in the order of the claim table. Each starts with the finding in one sentence, then the evidence, then its limits.
- **Related work:** organized by question, stating precisely how this paper differs.
- **Limitations:** the scope the evidence does not cover, stated plainly.

Write plainly: one idea per paragraph, the finding first, concrete numbers instead of adjectives. Figures need a caption that says what to see in them.

## 4. Review

Before calling a draft done, have it reviewed independently (see [Research Review](../research-review/SKILL.md)): at least one reviewer reads only the PDF, without the author's notes, and writes what they think the claim is, what convinced them and what did not. Run a claim-evidence audit on every load-bearing number. Compare the reviewers' summary of the claim with yours; a mismatch is a writing problem.

## 5. Revise and close the loop

Fix the highest-impact issues first: wrong or unsupported claims, then missing evidence, then structure, then wording. After each revision, recheck the claims that changed and keep the claim table current. When the paper reveals a reusable lesson about how you write, add it to this skill instead of keeping it in one paper's notes.
