# Design: unconditional user attribution on the fork

Date: 2026-07-28
Repo: `bormog/claude-threads` (private fork of `anneschuth/claude-threads`)
Status: approved, pre-implementation

## Background

PR [#437](https://github.com/anneschuth/claude-threads/pull/437) (our per-message
`[@username]:` attribution) was **not rejected**. The maintainer carried its 24
commits forward into his own PR #446 with authorship intact, and shipped them in
**v1.19.0** (`upstream/main` = `44aeecd`). The design, the
`src/operations/user-attribution/` module, the tests and the CHANGELOG credit are
all ours.

What he added on top: the flag default flipped `false` → `true`, but the prefix is
now gated on the session having more than one participant
(`src/operations/user-attribution/formatter.ts:61`):

```ts
export function shouldAttribute(enabled: boolean, participantCount: number): boolean {
  return enabled && participantCount > 1;
}
```

All six send sites pass `session.sessionAllowedUsers.size` as `participantCount`.

## Problem

The gate's "is this thread shared" signal cannot see our form of collaboration,
so on our production bot attribution never fires at all.

Verified against v1.19.0:

- `sessionAllowedUsers` grows in exactly two places — `!invite`
  (`src/operations/commands/handler.ts:555`) and another user reviving a paused
  session (`src/session/lifecycle.ts:345`).
- Access to a thread is granted by a different path:
  `isAuthorizedForSession` returns true for anyone the platform's **global**
  allowlist accepts (`src/session/authorization.ts:44-52`, empty allowlist =
  allow-all) and **does not** add them to `sessionAllowedUsers`.

Our deployment lists the whole team in the global `allowedUsers` and people write
into shared threads without `!invite`. So `sessionAllowedUsers.size` stays `1`
forever, `shouldAttribute` is always `false`, and Claude is back to seeing bare
text with no idea who is speaking.

This is a difference in how the tool is used, not a disagreement about the
feature: upstream treats claude-threads largely as screen-sharing of one person's
session; we run it as a bridge between Mattermost and Claude Code, so the bot is
a chat-resident agent several people task in parallel.

## Decision

Remove the guard on the fork. Attribution follows the config flag alone.

Rejected alternatives:

- **Fix the signal** (count actual speakers in a separate `Set`, leave the guard
  in place). Correct, upstream-able, keeps solo threads clean — but more code and
  new persisted state for no benefit we need. The prefix in a solo thread is
  harmless: the system-prompt note already tells Claude to treat it as speaker
  metadata.
- **A third config mode** (`userAttribution: true | false | 'always'`). Ripples a
  `boolean` → union through `Config`, `SessionManager`, `Session`,
  `PersistedSession`, onboarding and a persisted-value migration. More cost than
  the fix-the-signal option, less value.

## Delta

Everything is shaped to keep future `git rebase upstream/main` cheap.

### `src/operations/user-attribution/formatter.ts`

```ts
export function shouldAttribute(enabled: boolean, _participantCount: number): boolean {
  return enabled;
}
```

The second parameter is **kept**, prefixed with `_` (allowed by
`eslint.config.js:22`, `argsIgnorePattern: '^_'`). That is deliberate: all six
call sites in `session/lifecycle.ts`, `operations/message-manager.ts`,
`operations/context-prompt/handler.ts` and `operations/worktree/handler.ts` stay
byte-identical to upstream, so a rebase conflicts in one file instead of six.

Its doc comment currently argues for the gate and must be rewritten to state the
real reason it is gone: collaboration here arrives through the global allowlist,
which never touches `sessionAllowedUsers`.

### Tests

Only one existing test file asserts the guard:
`src/operations/user-attribution/formatter.test.ts` — `shouldAttribute(true, 1)`
and `shouldAttribute(true, 0)` now return `true`; the "flag off ⇒ never
attribute" case is unchanged.

One test is **added**, because a predicate test alone would not prove the wire
format: a solo session (`sessionAllowedUsers = {'testuser'}`) with the flag on
must reach Claude as `[@alice]: …` through the real `handleUserMessage` path
(`src/operations/message-manager.test.ts`, alongside the existing
`handleUserMessage attribution` describe). It is red before the patch and green
after.

Everything else stays green, verified case by case:

- `tests/integration/suites/session-lifecycle.test.ts:278` ("sends user turns raw
  when userAttribution is not configured") does **not** depend on the guard: the
  integration harness defaults the flag to `false`
  (`tests/integration/helpers/bot-starter.ts:142`) and `getPlatformBotOptions`
  only spreads the options it is given, so that session has attribution off
  outright.
- `message-manager.test.ts`, `context-prompt/handler.test.ts`,
  `worktree/handler.test.ts`, `manager.test.ts` — each either seeds two
  participants or leaves the flag off.
- `restart-rebind.test.ts` and the `resumePausedSession` regression test in
  `lifecycle.test.ts` assert the system-prompt note and the sender argument, both
  keyed off the flag rather than the guard.
- `onboarding.test.ts`, `system-prompt-generator.test.ts` — flag-level only.

### Comments that would otherwise lie

- `src/index.ts:582` — "only applied once a thread has >1 participant".
- `src/session/types.ts:313` — doc comment on `Session.userAttribution` pointing
  at `shouldAttribute`.

### Not touched, on purpose

`CHANGELOG.md`. It is upstream's release notes; editing it guarantees a conflict
on every upstream release. The divergence is documented in a new root
`FORK_NOTES.md` instead — a path upstream does not have, so it can never
conflict. It records what was removed, why, and the rebase recipe.

## Branching

- `main` fast-forwards `cb1fb50` → `44aeecd` (v1.19.0) and is pushed to `origin`.
  It stays a pure mirror of upstream so rebases are clean.
- `feat/user-attribution` is left alone as the history of PR #437. It must **not**
  be rebased — its content is already inside `upstream/main`, so a rebase would
  produce 24 duplicate commits.
- Work lands on a new thin branch off the fresh `main`: `fork/attribution-always`.

## Gates

`bun install`, `bun test`, `bun run lint`, `bunx tsc --noEmit`, `bun run knip`.

knip is no longer a problem: upstream pinned it in 1.18.4 and added
`src/**/index.ts` to `entry`, so the red CI check we had to explain in PR #437 is
gone.

## Delivery to production

1. Clone / pull the fork branch on the production machine.
2. `bun install && bun run build` — a git-npm install would not build `dist`, so
   the `bin` would be broken.
3. Expose it as `claude-threads` via `bun link`, or run from the checkout.
4. Set `autoUpdate.enabled: false` in `config.yaml` — otherwise the auto-updater
   fetches npm-latest and respawns onto it, clobbering the fork.
5. Remove the globally installed upstream binary with whichever manager installed
   it (`npm rm -g claude-threads` / `bun rm -g claude-threads`).

Behaviour to expect: no config change is needed, because `userAttribution`
defaults to `true` in v1.19.0. But resume reads `state.userAttribution ?? false`
(`src/session/lifecycle.ts:1255`), so threads already in `sessions.json` that
started before the flag existed stay unattributed — names appear in new threads.
