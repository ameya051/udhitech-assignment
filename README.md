# Science Diagram Maker

Live app: https://udhitech-assignment.vercel.app/

## What it does

The app asks Claude Sonnet 5.5 (through OpenRouter) to draw one animated SVG diagram for each of 5 GCSE science concepts. Code checks every SVG before it is accepted, and if a check fails the model gets one retry with the exact failure messages. A web page shows the 5 saved results in a table: the diagram, pass/fail for each check, cost, tokens and retries, Approve/Reject with a note, and a Generate button that runs the pipeline live for one concept.

## Run it locally

1. Node 20.6+ (the generate script uses `--env-file`). Run `npm install`.
2. Create an OpenRouter API key at openrouter.ai. Giving it a credit limit is optional.
3. Run `cp .env.example .env` and set `OPENROUTER_API_KEY`. `LLM_MODEL` defaults to `anthropic/claude-sonnet-5.5`.
4. Commands:
   - `npm run generate` runs all 5 concepts and writes `results.json`
   - `npm run generate -- --only=photosynthesis` regenerates one concept and keeps the other saved rows
   - `npm run dev` opens the table at http://localhost:3000
   - `npm test` and `npm run lint`

## How it works

1. `lib/prompt.ts` builds the request from the concept text (`lib/concepts.ts`).
2. `lib/llm.ts` (`callLlm`) calls the OpenRouter chat completions API with plain `fetch`. On 429, 503 or a network error it waits and retries up to 3 times. The wait comes from `Retry-After`, or is 2s/4s/8s (capped at 20s) plus up to 500ms of jitter. Each call has a 45s timeout, and any other error fails straight away.
3. `lib/extractSvg.ts` pulls the `<svg>` block out of the reply.
4. `lib/checks/` runs the 5 checks.
5. `lib/pipeline.ts`: if any check fails, it retries **once** and sends the model the failing checks' details. It adds up tokens, API retries and cost, and logs one JSON line per attempt (never the key or the full SVG).
6. `scripts/generate.ts` saves the final results to `results.json`. The page (`app/page.tsx`) imports that file, so **page load makes no API call**.
7. The Generate button posts to `app/api/generate/route.ts`, which runs the same pipeline for one concept. That route is limited to 5 requests per IP per 10 minutes.

## Results

These come from the committed `results.json` (run on 2026-11-24):

| Concept | Pass/Fail | Cost (USD) | Check retries | API retries | Tokens in / out |
|---|---|---|---|---|---|
| Pythagoras' theorem | Pass (5/5) | $0.0121 | 0 | 0 | 823 / 1,046 |
| Parts of a circle | Pass (5/5) | $0.0071 | 0 | 0 | 819 / 548 |
| Series circuit | Pass (5/5) | $0.0131 | 0 | 0 | 800 / 1,149 |
| Photosynthesis | Pass (5/5) | $0.0139 | 0 | 0 | 804 / 1,232 |
| States of matter | Pass (5/5) | $0.0229 | 0 | 0 | 805 / 2,130 |
| **Total** | **5 / 5** | **$0.0692** | 0 | 0 | 4,051 / 6,105 |

**Model:** Claude Sonnet 5.5 via OpenRouter (`anthropic/claude-sonnet-5.5`). The brief suggests a free Gemini model. The hiring team confirmed that the model choice is ours, and I picked Sonnet for the quality of its SVG layouts.

**Cost:** estimated at list price, $2 per 1M input tokens and $10 per 1M output tokens, with reasoning tokens counted as output. The estimate is cross-checked against the `usage.cost` that OpenRouter reports, and the two matched on every row. All 5 rows report 0 reasoning tokens.

**Budget limit:** the deployed app uses a separate OpenRouter key with a **$2 credit limit**, so the public Generate button can't spend more than that. When the limit is used up, the page says "The live demo budget is used up" and the 5 saved results stay as they are.

**This run was not the first.** This run passed all 5 concepts on the first attempt. Earlier runs failed in several ways, some caused by my checks and some by the model. They are described below in [What failed](#what-failed-and-how-i-fixed-it).

## Checks

Each check returns pass/fail plus a `detail` message. On a failure, that message is written to be sent back to the model as the retry instruction, for example by naming the element, its estimated box and the viewBox edge it crosses.

1. **Valid SVG** (`parse.ts`): parses with `@xmldom/xmldom`. The root must be `<svg>` in the SVG namespace and have a usable `viewBox`. xmldom accepts a bare `&`, which browsers reject, so that is checked separately. If parsing fails, the other checks show as "Skipped".
2. **Inside viewBox** (`bounds.ts`, `drawn.ts`, `geometry.ts`, `motion.ts`, `textWidth.ts`): works out a bounding box for every drawn element, including rect, circle, ellipse, line, polyline, polygon, path and text. Transforms are applied, and a path parser handles the full path syntax. Each box must fit inside the viewBox, with 2 units of slack. Text width uses Arial's real per-character widths (×1.1 for bold). `<animateMotion>` paths are added to the element's position, because moving particles are often drawn at (0,0) and placed only by their motion path. Limits are listed below.
3. **Title + labels** (`labels.ts`): needs a non-empty `<title>` and at least 3 non-empty `<text>` labels.
4. **Animated** (`animation.ts`): passes if there is a SMIL element (`animate`, `animateTransform`, `animateMotion`, `set`), or a CSS `@keyframes` rule that some `animation` declaration actually uses. An unused `@keyframes` rule does not count.
5. **Labels clear of lines** (`labelsClear.ts`, my own check): no stroked line or shape outline may run through a text label's estimated box. Circles are traced as 48 straight sides, curves are sampled, and lines are tested every 1 unit. Rotated labels are tested in their own rotated frame.
   **Why this check:** I looked at the diagrams by eye after an early run. In "Parts of a circle", every check passed, but "Radius" was written across the circle's edge and "Centre" sat on the radius line. A label you can't read is the most common way these diagrams fail a student, and none of the required checks look for it. I first built a check for labels overlapping other labels, but it didn't catch either of those cases, so I replaced it with this one. Since then it has caught real problems: "Chlorophyll" (white text) straddling the leaf's edge in Photosynthesis, so part of it was white on white.

## Where approvals are saved, and why

Approvals are saved in **browser localStorage**, one key per concept (`review:v1:<conceptId>`), holding the decision and the note. Notes save after a short pause in typing, and a "Saved" indicator confirms it. Clicking the active decision again clears it.

**Why:** the brief rules out a database and auth. Vercel's filesystem is read-only, and a shared database without auth would let anyone with the link overwrite anyone else's reviews.

**Tradeoff:** decisions belong to one browser. They are not shared between reviewers and are lost if site data is cleared.

**With more time:** a small table (Vercel KV or Supabase) behind a simple login, so reviews are shared and you can see who made each one.

## What failed, and how I fixed it

I didn't get to 5/5 on the first try. Some failures were the model's fault, and several were my checks being wrong.

**Run 1: 3 pass / 2 fail, $0.126 total**
- **False failures (my bug):** the bounds check ignored `<animateMotion>`. Photosynthesis particles drawn at `cx=0 cy=0` and moved along a path were flagged as outside the viewBox (6 of them), and circle-parts attempt 1 was flagged the same way. **Fix:** `motion.ts` adds the motion path's offsets to the element. The element's own position still counts while the motion isn't running, such as before a delayed `begin`.
- **Knock-on effect:** that false message confused the model on the circle-parts retry. It sent a draft SVG, then "Wait: …", then a corrected SVG. `extractSvg` took everything from the first `<svg` to the last `</svg>` and glued them into invalid XML. **Fix:** take the last complete top-level `<svg>` block.
- **Real failure, kept:** 3 photosynthesis circles had `begin="2s"` and sat in the top-left corner for 2 seconds before moving. The check was right to flag them.
- **False pass (not caught):** in Pythagoras, the "b²" square was 100×100 on a side of length 200, and its caption made no sense. No check tests scientific or mathematical accuracy. The model also left its reasoning in XML comments.

**Run 2 (with labelsClear): 4 pass / 1 fail**
- Circle-parts fixed "Centre" and "Radius" on its retry.
- Photosynthesis failed both attempts. The white "Chlorophyll" label at x=296 straddled the leaf's lower-left edge (x≈335 at that height). The retry message named the label and the line but not where they crossed, so the model didn't move it far enough. **Fix:** the failure detail now gives the crossing point and the label's estimated box. The prompt also says that a label inside a shape must fit, or go outside with a leader line.

**Run 3: false bounds failure in Series circuit**
- The end-anchored label "between components" (x=190, font size 18) was estimated at 0.6em per character, which put its start at x=−4.4. Its real Arial width is 171, so it actually starts at x≈19. **Fix:** `textWidth.ts` uses Arial's per-character widths. It is shared by the bounds check and labelsClear.
- I suspected a false "no animation" on Pythagoras, but it was a subtle CSS opacity pulse on the b² square. The check was right.

**Final run (committed):** 5/5 pass on the first attempt, $0.069. I never hit a 429/503 in practice. The retry logic is covered by unit tests (`tests/llm.test.ts`) with a fake `fetch`.

## Known limitations

- **Bounds and labelsClear only estimate geometry.** There is no browser rendering, so:
  - Arc bulges in paths are approximated, and labelsClear draws arcs as straight chords.
  - `<use>` elements are skipped.
  - `<style>` class rules are not applied, so a `font-size` set by class is missed. 3 of the 5 SVGs style text by class.
  - `<tspan>` x/y/dy positions are not followed.
  - Only `<animateMotion>` movement is simulated. Movement from `<animate>`, `<animateTransform>`, CSS animation, or `animateMotion rotate` is not.
- **Text width assumes Arial/Helvetica/Liberation Sans.** If a browser falls back to a wider sans-serif font, real text is wider than the estimate.
- **labelsClear:**
  - It ignores rect `rx` (rounded corners).
  - It skips animated labels and moving lines.
  - It still flags a label that sits on an opaque background box over a line.
  - It does not check labels overlapping other labels.
- **No accuracy check.** A diagram can pass every check and still be scientifically wrong, like the Pythagoras square in run 1.
- **The live rate limit is best effort.** It is counted per serverless instance, in memory. It trusts `x-forwarded-for`, which Vercel sets but which can be spoofed locally.
- **Approvals are per browser** (see above).

## With one more day

- Render each SVG in a headless browser to get exact bounds and label boxes, which would remove most of the estimation limits above, and add visual diffs between runs.
- Add an accuracy check: an LLM-as-judge with a per-concept rubric (e.g. "the squares' side lengths match the triangle's sides"), which would have caught the Pythagoras case.
- Apply `<style>` rules in the checks.
- Store reviews in a shared database behind a login.
- Cache identical prompts, and add a small dashboard of cost and latency over time.

## AI tools used

**Claude Code** was the only AI tool I used:
- **Planning:** it helped me write the build brief and a phase-by-phase plan.
- **Code:** it wrote the code and tests one phase at a time. It checked library and API details in current docs as it went (OpenRouter's model id, prices and error shapes, xmldom's error handler, Next.js route config).

**My part:**
- I reviewed every diff and did all git work by hand.
- I ran the real generations and judged the diagrams by eye. Spotting the unreadable labels on the circle diagram is what led to the labelsClear check.
- I decided what to fix after each run: the check when it was wrong, the prompt when the model was wrong.
