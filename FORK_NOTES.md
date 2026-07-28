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

### Files that carry the divergence

| File | What differs |
|------|--------------|
| `src/operations/user-attribution/formatter.ts` | The `shouldAttribute` body and its doc comment. The only behavioural change. |
| `src/operations/user-attribution/formatter.test.ts` | `describe('shouldAttribute')` asserts the new semantics. |
| `src/operations/message-manager.test.ts` | Adds "prefixes a solo session too", proving the wire format through the real `handleUserMessage` path. |
| `src/index.ts`, `src/session/types.ts`, `CLAUDE.md`, `docs/CONFIGURATION.md` | Comments and docs that described the guard. |

`CHANGELOG.md` is intentionally left as upstream's release notes; editing it
would conflict on every upstream release.

## Rebasing onto a new upstream release

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout fork/attribution-always
git rebase main
```

Expect at most one code conflict, in
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
