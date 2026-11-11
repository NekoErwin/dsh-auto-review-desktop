Based on @deepseek-ai/dsh-experimental-auto-review 0.2.2-rc.1 (MIT).

The vendored official module changes only its export list. Its original apply() is not used; src/index.js installs a new gate.

There is no runtime dependency on the official auto-review plugin being installed or enabled. The Desktop integration registers auto-review-desktop (Full access) and auto-review-workspace (Workspace), and does not disable, patch, or register the official auto preset. The vendored policy remains pinned to the version above and must be reviewed separately for upstream policy updates.

Workspace mode bypasses model review only for compatible native tools subject to the documented path checks and original sandbox. A native single-call escalation is answered at its audited approval boundary, using either human approval or the same reviewer. Precise-deletion model policy applies only to actions actually sent to the reviewer; exempt workspace operations do not run it. Windows shell confinement restricts writes but does not isolate reads, network access, or process visibility. Native schema fingerprints are compatibility checks, not authentication of trusted in-process Host plugin code.

The Desktop gate optionally appends its own precise-deletion review policy (enabled by default) and bounded retained tool observations. The vendored module itself is unchanged. The additional behavior is informed by OpenAI Codex commit fe8e540a80f17716bf2a3007f06e8a602192c704, codex-rs/prompts/templates/guardian/policy.md (destructive actions and low-risk actions) and policy_template.md (investigation guidelines); it does not reproduce Codex's full policy, tool investigation runtime, or command safety classifiers.

Upstream lib/index.js SHA-256: c516e8803facb9c8484f10c81037859826f1b1d0fef098d933ea23b38fd780b3
