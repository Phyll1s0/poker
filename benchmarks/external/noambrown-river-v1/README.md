# noambrown/poker_solver river oracle

This fixture is a small, deterministic, heads-up river conformance check. It
was generated from the MIT-licensed `noambrown/poker_solver` at commit
`6a10442877ffc8fd28af93e16e279b9bbdd97b2a` with double-precision CFR+.

The fixture stores the upstream action tokens and hand order verbatim. The
RangeCraft adapter replays the public state to distinguish `c = check` from
`c = call`, converts 100 chips to one big blind, canonicalizes each two-card
holding, and refuses partial node/action coverage.

`input.json` is the exact upstream configuration. The byte-for-byte raw
strategy file is preserved as base64 in `upstream-strategy.json.base64` so its
original no-trailing-newline bytes can be recovered exactly. The benchmark
command verifies both SHA-256 hashes, decodes the raw output, and checks that
its parsed strategy is identical to the readable snapshot in `reference.json`.

This proves implementation conformance on one locked subgame. It is not a
commercial strategy database, a multiway benchmark, or evidence that every
RangeCraft decision is an exact GTO solution.

Source and license:

- https://github.com/noambrown/poker_solver
- https://github.com/noambrown/poker_solver/blob/6a10442877ffc8fd28af93e16e279b9bbdd97b2a/LICENSE
- The upstream MIT license is preserved in this directory as `LICENSE`.
