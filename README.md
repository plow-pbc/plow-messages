# plow-messages

A CLI that reads the owner's iMessage archive (`~/Library/Messages/chat.db`)
with bodies already decoded — including the 84% of recent messages whose body
lives only in `attributedBody`, a typedstream blob a plain `select ... from
message where text like ?` never sees.

## Reads

- `search [PHRASE]` — messages whose body contains PHRASE, a literal
  case-insensitive substring.
- `thread (--chat-id N | --handle H...)` — one conversation, oldest first.
- `chats` — recent conversations, with the kind and the guid a send targets.
- `unreplied` — direct chats whose newest real message is inbound.

`--help` is the contract: it is the full usage text an agent (or a human) needs,
kept in sync with the flags because it ships from the same binary. There is no
separate reference to drift from it.

## How Latch ships it

Latch stages a released binary rather than this source tree: its
`latch-plugin.json` manifest pins a specific `plow-messages` release by tag and
sha256, per architecture, the same way it pins `plow-wiki`.

## Build & test

```sh
just test
```

macOS only — the CLI is Swift, built against `Foundation`'s typedstream
decoder, and the suite runs the built binary. `just build` alone produces
`dist/plow-messages` for this Mac's architecture.

## Release

Pushing a `v*` tag publishes a release.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 The
Plow Collective, Inc.

"Plow" and the Plow logo are trademarks of The Plow Collective, Inc. The
license grants no trademark rights.
