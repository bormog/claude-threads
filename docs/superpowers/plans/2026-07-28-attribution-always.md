# Unconditional User Attribution (fork) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the `bormog/claude-threads` fork, make `[@username]:` attribution follow the `userAttribution` config flag alone, dropping upstream's multi-participant guard that silences it permanently in our deployment.

**Architecture:** Sync `main` to `upstream/main` (v1.19.0, which already contains our feature), then land one thin branch whose entire code delta is the body of `shouldAttribute` in `src/operations/user-attribution/formatter.ts`. The function keeps its two-parameter signature — the second parameter becomes `_participantCount` and is ignored — so all six call sites stay byte-identical to upstream and future rebases conflict in one file only.

**Tech Stack:** TypeScript, Bun (test runner + bundler), ESLint, knip, husky/lint-staged. No new dependencies.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-28-attribution-always-design.md`. Read it before Task 2.
- **Commit identity:** every commit must be authored `bormog <bormog@gmail.com>` (already the repo-local `git config user.name` / `user.email` — do not override, do not add any other name or email).
- **Language:** all code comments, docs and commit messages in **English** (project convention, `CLAUDE.md`).
- **`main` is a pure mirror of upstream.** Never commit to it. All work lands on `fork/attribution-always`.
- **Never rebase or amend `feat/user-attribution`** — it is the history of PR #437 and its content is already inside `upstream/main`; rebasing would produce 24 duplicate commits.
- **Do not touch `CHANGELOG.md`** — it is upstream's release notes and editing it guarantees a conflict on every upstream release. Fork divergence is documented in `FORK_NOTES.md` only.
- **Do not modify the six `shouldAttribute` call sites** in `src/session/lifecycle.ts`, `src/operations/message-manager.ts`, `src/operations/context-prompt/handler.ts`, `src/operations/worktree/handler.ts`. Keeping them identical to upstream is the point of the two-parameter signature.
- **Gate commands** (exact): `bun test`, `bun run lint`, `bun run typecheck`, `bun run knip`. `bun test` runs unit tests only (`bun test src/`); integration tests need Docker and are out of scope for this plan.
- **Commit normally** (no `--no-verify`). The `.husky/pre-commit` hook runs `bunx lint-staged --allow-empty` then `bunx knip --no-config-hints`; upstream pinned knip as a devDependency in 1.18.4, so `bunx` resolves the local pinned binary and the hook is expected to pass. If knip does trip, read its output and fix the cause — do not blanket-skip the hook.

---

### Task 1: Sync the fork and open the working branch

Establishes the baseline: `main` at v1.19.0, a clean branch to work on, and a
recorded green test count so any later failure is unambiguously ours.

**Files:**
- Modify: none (git refs and `node_modules` only)

**Interfaces:**
- Consumes: nothing
- Produces: branch `fork/attribution-always` at `upstream/main` (`44aeecd`); a recorded baseline pass count from `bun test`

- [x] **Step 1: Confirm the working tree carries no tracked changes**

```bash
cd /Users/tehmomokox/pw/claude-threads
git status --porcelain
```

Expected: only untracked entries under `docs/superpowers/` (the spec and this
plan). If any **tracked** file is modified or staged, stop and report — do not
stash or discard someone else's work.

- [x] **Step 2: Fetch upstream and fast-forward `main`**

```bash
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git log --oneline -1
```

Expected: `main` moves `cb1fb50` → `44aeecd` and the log line reads
`44aeecd Per-message user attribution, default on for shared threads (#446)`.
If `--ff-only` refuses, stop and report: it means `main` has local commits it
should not have.

- [x] **Step 3: Push the synced `main` to the fork**

```bash
git push origin main
```

Expected: `origin/main` now also points at `44aeecd`.

- [x] **Step 4: Create the working branch**

```bash
git checkout -b fork/attribution-always
```

- [x] **Step 5: Install dependencies at the new lockfile**

```bash
bun install
git status --porcelain -- bun.lock package-lock.json
```

Expected: install succeeds and neither lockfile is modified (upstream's locks are
already in sync). If a lockfile does change, report it before continuing — it
must not ride along in a later commit.

- [x] **Step 6: Record the green baseline**

```bash
bun test 2>&1 | tail -5
bun run lint
bun run typecheck
bun run knip
```

Expected: `bun test` reports `0 fail` — write down the pass count, it is the
reference for Task 2. `lint`, `typecheck` and `knip` all exit 0. If anything is
red **before any edit**, stop and report: the baseline is broken, not the patch.

- [x] **Step 7: No commit**

This task changes no files. Deliverable is the branch plus the recorded baseline.

---

### Task 2: Drop the multi-participant guard

The behaviour change, done RED→GREEN: the tests are rewritten to the new
semantics first and must fail against the un-patched code, which proves they
actually exercise the guard rather than restating it.

**Files:**
- Modify: `src/operations/user-attribution/formatter.ts:44-63` (doc comment + function body)
- Test: `src/operations/user-attribution/formatter.test.ts` (`describe('shouldAttribute')`, ~lines 49-72)
- Test: `src/operations/message-manager.test.ts` (`describe('handleUserMessage attribution')`, ~lines 929-952)

**Interfaces:**
- Consumes: branch `fork/attribution-always` from Task 1
- Produces: `shouldAttribute(enabled: boolean, _participantCount: number): boolean` — same signature as upstream, returns `enabled`. `formatUserTurn(message, username, enabled)` is untouched.

- [x] **Step 1: Rewrite the `shouldAttribute` test block to the new semantics**

In `src/operations/user-attribution/formatter.test.ts`, replace the whole
`describe('shouldAttribute', ...)` block with:

```ts
describe('shouldAttribute', () => {
  it('attributes in a solo session — this fork drops the multi-participant gate', () => {
    // Upstream gates on `participantCount > 1`, reading the size of
    // `sessionAllowedUsers`. That set only grows via `!invite` or a paused
    // session revived by someone else, while anyone the platform's global
    // allowlist accepts can write into a thread without ever entering it. On
    // this deployment the whole team is globally allowed and shares threads
    // without `!invite`, so the count stays 1 and the guard would silence
    // attribution permanently. See FORK_NOTES.md.
    expect(shouldAttribute(true, 1)).toBe(true);
  });

  it('attributes when a session has more than one participant', () => {
    expect(shouldAttribute(true, 2)).toBe(true);
    expect(shouldAttribute(true, 5)).toBe(true);
  });

  it('never attributes when the flag is off, however many participants', () => {
    expect(shouldAttribute(false, 1)).toBe(false);
    expect(shouldAttribute(false, 2)).toBe(false);
    expect(shouldAttribute(false, 99)).toBe(false);
  });

  it('ignores the participant count entirely', () => {
    // The count is still accepted so every call site stays byte-identical to
    // upstream, which keeps rebases cheap; it must not influence the decision.
    expect(shouldAttribute(true, 0)).toBe(true);
  });
});
```

Leave the `sanitizeUsername` and `formatUserTurn` blocks in that file alone.

- [x] **Step 2: Add the wire-format test for a solo session**

A predicate test would pass even if a call site stopped consulting it, so add a
test that drives the real `handleUserMessage` path. In
`src/operations/message-manager.test.ts`, inside the existing
`describe('handleUserMessage attribution', ...)`, add this as the **first** `it`:

```ts
    it('prefixes a solo session too — this fork drops the multi-participant gate', async () => {
      // The sibling tests below add a 'collaborator' to satisfy upstream's
      // `participantCount > 1` guard. That call is redundant on this fork but
      // is deliberately left in place to minimise divergence from upstream.
      // Here the session stays solo (sessionAllowedUsers = {'testuser'}) and
      // must still be attributed. See FORK_NOTES.md.
      session.userAttribution = true;
      await manager.handleUserMessage('deploy it', undefined, 'alice');
      const sent = (session.claude.sendMessage as any).mock.calls[0][0];
      expect(sent).toBe('[@alice]: deploy it');
    });
```

Do not modify the three existing `it`s in that describe.

- [x] **Step 3: Run both test files and verify they FAIL**

```bash
bun test src/operations/user-attribution/formatter.test.ts src/operations/message-manager.test.ts 2>&1 | tail -20
```

Expected: **3 failures** —
- `attributes in a solo session …`: `expect(false).toBe(true)`
- `ignores the participant count entirely`: `expect(false).toBe(true)`
- `prefixes a solo session too …`: received `'deploy it'`, expected `'[@alice]: deploy it'`

If any of the three passes here, the test does not exercise the guard — fix the
test before touching the implementation.

- [x] **Step 4: Remove the guard**

In `src/operations/user-attribution/formatter.ts`, replace lines **44-63** — that
is, from ` * Whether a session should actually attribute its turns right now.`
through the closing `}` of `shouldAttribute`. Line 43 is the comment's opening
`/**` and must stay, which is why the replacement below begins with ` * ` and
carries its own closing ` */`:

```ts
 * Whether a session should actually attribute its turns right now.
 *
 * FORK DIVERGENCE — see FORK_NOTES.md. Upstream also requires
 * `participantCount > 1`, so a solo thread never carries a prefix. That guard
 * reads `session.sessionAllowedUsers.size`, a set which grows only via
 * `!invite` or another user reviving a paused session — while anyone the
 * platform's global allowlist accepts may write into a thread without ever
 * entering it (`isAuthorizedForSession`, src/session/authorization.ts). This
 * deployment has the whole team globally allowed and sharing threads without
 * `!invite`, so the count stays 1 forever and attribution would never fire.
 * The decision is therefore the config flag alone.
 *
 * `participantCount` is still accepted, and ignored, so all six call sites stay
 * byte-identical to upstream and a rebase conflicts in this file only.
 *
 * Kept as a pure predicate over primitives (not a `Session`) so it stays
 * trivially testable and introduces no import cycle into the session module.
 */
export function shouldAttribute(enabled: boolean, _participantCount: number): boolean {
  return enabled;
}
```

The `_` prefix is what keeps ESLint quiet — `eslint.config.js:22` sets
`argsIgnorePattern: '^_'`. Do not drop the parameter.

- [x] **Step 5: Run the same two files and verify they PASS**

```bash
bun test src/operations/user-attribution/formatter.test.ts src/operations/message-manager.test.ts 2>&1 | tail -10
```

Expected: `0 fail`.

- [x] **Step 6: Run the full gates**

```bash
bun test 2>&1 | tail -5
bun run lint
bun run typecheck
bun run knip
```

Expected: `0 fail`, with the pass count equal to Task 1's baseline **+1** (the
new message-manager test). `lint`, `typecheck` and `knip` exit 0. Any other test
turning red is a real finding — report it with the failure output instead of
adjusting the test to match.

- [x] **Step 7: Commit**

```bash
git add src/operations/user-attribution/formatter.ts \
        src/operations/user-attribution/formatter.test.ts \
        src/operations/message-manager.test.ts
git commit -m "fix: attribute every user turn, dropping the multi-participant gate

Upstream gates attribution on sessionAllowedUsers.size > 1, but that set is
only grown by !invite and paused-session revival. Users admitted by the
platform's global allowlist never enter it, so on this deployment the count
stays 1 and the prefix never appears. shouldAttribute now follows the config
flag alone; the participant count is kept as an ignored parameter so every
call site stays identical to upstream."
```

---

### Task 3: Document the divergence and fix the comments it invalidates

Two comments now describe behaviour the fork no longer has, and a future rebase
needs a written recipe. Docs-only — no behaviour change.

**Files:**
- Create: `FORK_NOTES.md`
- Modify: `src/index.ts:582` (trailing comment on the `config.userAttribution` argument)
- Modify: `src/session/types.ts:309-317` (doc comment on `Session.userAttribution`)
- Modify: `CLAUDE.md:114` and `docs/CONFIGURATION.md:48` (found during execution — both document the guard; `CLAUDE.md` is loaded into every session in this repo, so a false line there misinforms future work)
- Add to git: `docs/superpowers/specs/2026-07-28-attribution-always-design.md`, `docs/superpowers/plans/2026-07-28-attribution-always.md`

**Interfaces:**
- Consumes: the patched `shouldAttribute` from Task 2
- Produces: `FORK_NOTES.md` at the repo root — the file both code comments and test comments point at

- [x] **Step 1: Write `FORK_NOTES.md`**

```markdown
# Fork notes

`bormog/claude-threads` — a fork of [`anneschuth/claude-threads`](https://github.com/anneschuth/claude-threads)
kept only for the divergence below. `main` is a pure mirror of `upstream/main`;
all local work lives on `fork/attribution-always`.

## Divergence: attribution is not gated on participant count

**One function differs from upstream:** `shouldAttribute` in
`src/operations/user-attribution/formatter.ts` returns the `userAttribution`
config flag alone, instead of `enabled && participantCount > 1`.

Why: the per-message `[@username]:` feature is ours (PR #437, carried upstream by
#446 and shipped in v1.19.0), and upstream added a guard so solo threads stay
clean. The guard's signal is `session.sessionAllowedUsers.size`, a set grown only
by `!invite` or another user reviving a paused session. Access to a thread is
granted elsewhere: `isAuthorizedForSession` (`src/session/authorization.ts`)
admits anyone the platform's **global** allowlist accepts and never adds them to
that set. This bot runs as a chat-resident agent with the whole team in the
global allowlist, sharing threads without `!invite` — so the count stays 1 and
attribution would never fire.

The parameter is deliberately kept as an ignored `_participantCount` so the six
call sites in `session/lifecycle.ts`, `operations/message-manager.ts`,
`operations/context-prompt/handler.ts` and `operations/worktree/handler.ts` stay
byte-identical to upstream.

Tests covering the divergence:

- `src/operations/user-attribution/formatter.test.ts` — `describe('shouldAttribute')`.
- `src/operations/message-manager.test.ts` — "prefixes a solo session too", which
  proves the wire format through the real `handleUserMessage` path.

`CHANGELOG.md` is intentionally left as upstream's release notes; editing it
would conflict on every upstream release.

## Rebasing onto a new upstream release

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout fork/attribution-always
git rebase main
```

Expect at most one conflict, in
`src/operations/user-attribution/formatter.ts`. Resolve by keeping our body
(`return enabled;`) over whatever upstream's guard has become, then:

```bash
bun install
bun test && bun run lint && bun run typecheck && bun run knip
```

If upstream ever changes `shouldAttribute`'s arity, update the call sites to
match upstream exactly and keep the divergence confined to the body.

## Running this fork in production

A `bun install -g github:...` would not build `dist/`, so `bin` would be broken.
Build from a checkout instead:

```bash
git fetch origin && git checkout fork/attribution-always && git pull
bun install && bun run build
bun link          # exposes the `claude-threads` command
```

Then, in `~/.config/claude-threads/config.yaml`, set:

```yaml
autoUpdate:
  enabled: false   # otherwise the auto-updater respawns onto npm-latest and clobbers this fork
```

and remove any globally installed upstream binary
(`npm rm -g claude-threads` / `bun rm -g claude-threads`).

`userAttribution` needs no config entry — it defaults to `true` in v1.19.0. Note
that resume reads `state.userAttribution ?? false`
(`src/session/lifecycle.ts:1255`), so threads already in `sessions.json` from
before the flag existed stay unattributed; names appear in new threads.
```

- [x] **Step 2: Fix the `src/index.ts` comment**

Replace the trailing comment on line 582 so it stops claiming the guard:

```ts
    config.userAttribution  // Per-message [@username]: attribution (default on; this fork attributes every user turn — see FORK_NOTES.md)
```

- [x] **Step 3: Fix the `Session.userAttribution` doc comment**

In `src/session/types.ts`, replace the doc comment at lines 309-317 with:

```ts
  /**
   * When `true`, every genuine user turn sent to Claude is prefixed with the
   * sender's `[@username]:` so Claude can tell who is speaking in a shared
   * thread. Unlike upstream, this fork applies it to every user turn regardless
   * of participant count — see `shouldAttribute` and FORK_NOTES.md. Seeded from
   * `Config.userAttribution` at session start (default `true`); resumed sessions
   * keep their persisted value, and sessions persisted before the flag existed
   * read as `false`. No runtime toggle.
   */
```

- [x] **Step 4: Verify nothing broke**

```bash
bun run typecheck
bun run lint
bun test 2>&1 | tail -5
```

Expected: all green, same pass count as the end of Task 2 (comments and a new
markdown file cannot change behaviour).

- [x] **Step 5: Commit**

```bash
git add FORK_NOTES.md src/index.ts src/session/types.ts \
        docs/superpowers/specs/2026-07-28-attribution-always-design.md \
        docs/superpowers/plans/2026-07-28-attribution-always.md
git commit -m "docs: record the attribution fork divergence and its rebase recipe

Adds FORK_NOTES.md (what differs, why, how to rebase, how to run in
production) and corrects the two comments that still described upstream's
multi-participant gate. Ships the design spec and implementation plan, which
live only on the fork."
```

- [x] **Step 6: Push the branch**

```bash
git push -u origin fork/attribution-always
```

---

### Task 4: Cut over the production machine

**Runs on the production machine, by the operator** — an agent on this machine
cannot do it. Verification is a real two-person thread.

**Files:**
- Modify: `~/.config/claude-threads/config.yaml` on the production machine

**Interfaces:**
- Consumes: branch `fork/attribution-always` pushed to `origin` by Task 3
- Produces: a running fork build; the upstream binary gone

- [ ] **Step 1: Get the fork onto the machine**

If claude-threads was never cloned there:

```bash
git clone git@github.com:bormog/claude-threads.git
cd claude-threads
git checkout fork/attribution-always
```

Otherwise, in the existing checkout:

```bash
git fetch origin && git checkout fork/attribution-always && git pull
```

- [ ] **Step 2: Build and expose the command**

```bash
bun install
bun run build
bun link
which claude-threads
```

Expected: `which` resolves to the linked checkout, not a global npm path.

- [ ] **Step 3: Disable auto-update**

In `~/.config/claude-threads/config.yaml`:

```yaml
autoUpdate:
  enabled: false
```

Without this the auto-updater fetches npm-latest and respawns onto it, silently
replacing the fork.

- [ ] **Step 4: Remove the upstream binary**

Use whichever manager installed it:

```bash
npm ls -g --depth=0 | grep claude-threads && npm rm -g claude-threads
bun pm ls -g 2>/dev/null | grep claude-threads && bun rm -g claude-threads
which -a claude-threads
```

Expected: only the linked fork path remains.

- [ ] **Step 5: Start it and check the version**

```bash
claude-threads
```

Expected: the header reports **1.19.0**. In the channel, ask the bot what version
it runs to confirm it is the live process.

- [ ] **Step 6: Verify attribution end to end with two people**

Start a **new** thread (threads already in `sessions.json` from before the flag
keep their persisted value) and have two different users write into it. Then
confirm the prefixes actually reached Claude, reading its own transcript:

```bash
latest=$(ls -t ~/.claude/projects/*/*.jsonl | head -1) && echo "$latest"
grep -o '\[@[A-Za-z0-9._-]*\]' "$latest" | sort -u
```

Expected: both users' logins appear. Then check the bot's replies in the thread
do **not** echo `[@…]` back and that thread titles / suggested branch names carry
no prefix — the attribution must exist only on the wire to Claude.

- [ ] **Step 7: No commit**

This task changes only machine-local configuration.
