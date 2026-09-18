# plow-messages

A CLI that reads the owner's iMessage archive (`~/Library/Messages/chat.db`)
with bodies already decoded, including the messages whose body lives only in
`attributedBody`, a typedstream blob a plain `select ... from message where
text like ?` never sees. `plow-messages --help` is the contract; `skill.md` is
the agent-facing page.

## Build & test

```sh
npm ci
just test
```

macOS only — the CLI is Swift, built against `Foundation`'s typedstream
decoder, and the suite runs the built binary.

## Release

Pushing a `v*` tag publishes a release.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 The
Plow Collective, Inc.

"Plow" and the Plow logo are trademarks of The Plow Collective, Inc. The
license grants no trademark rights.
