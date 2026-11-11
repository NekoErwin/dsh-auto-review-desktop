Based on @deepseek-ai/dsh-experimental-auto-review 0.2.2-rc.1 (MIT).

The vendored official module changes only its export list. Its original apply() is not used; src/index.js installs a new gate.

There is no runtime dependency on the official auto-review plugin being installed or enabled. The Desktop integration registers only auto-review-desktop and does not disable, patch, or register the official auto preset. The vendored policy remains pinned to the version above and must be reviewed separately for upstream policy updates.

Upstream lib/index.js SHA-256: c516e8803facb9c8484f10c81037859826f1b1d0fef098d933ea23b38fd780b3
