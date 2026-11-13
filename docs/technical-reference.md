# DSH enhanced review

Version **0.4.10**, compatible with **DSH 0.2.0+**. [中文](technical-reference.zh.md).

An independent authorization reviewer for DSH, with native settings, two permission modes, inherited child-agent policies and persistent review history. It bundles an attributed MIT snapshot of the official review implementation; the official auto-review plugin need not be installed or enabled. See [NOTICE](../NOTICE.md) and [LICENSE](../LICENSE).

## Permission modes

Choose a mode in the conversation permission menu, or use `/permission auto-review-workspace` and `/permission auto-review-desktop`.

| Mode | Session sandbox | Review behavior |
| --- | --- | --- |
| Auto review (Workspace) | `workspace-write` | Compatible native workspace operations and configured native reads skip model review. Other actions follow the outside-workspace policy. |
| Auto review (Full access) | `danger-full-access` | Each actual action is reviewed using the configured model. |

The plugin contributes its own entries. Existing `auto-review-desktop` sessions retain Full access. Saving settings does not switch the session mode. A model allow applies to one action and remains subject to other permission checks.

## Platforms and shells

Runtime code supports Windows, Linux and macOS through DSH's filesystem, sandbox, shell and working-directory services. Both native `pwsh` and `bash` are recognized using complete DSH 0.2.2-rc.1 schema fingerprints. The plugin neither translates commands between shells nor starts a shell itself. Use the shell supplied by the host: PowerShell on Windows, Bash on typical Linux/macOS profiles. The macOS login shell may be zsh; that does not turn DSH's Bash tool into zsh. Unknown tools or altered schemas go through the configured approval policy.

For compatible native shells, the actual `workspace-write` executor remains active. An in-workspace workdir skips review; an outside workdir follows the outside-workspace policy. Explicit `sandbox_permissions: "danger-full-access"` with a justification is decided inside the native single-action approval boundary. This never changes the session's standing permissions. Known authorized outside actions may request escalation on their first call; a deliberately failed probe is unnecessary. Do not automatically replay a denied shell command: it may have had partial effects.

Path resolution, links and containment use `ctx.fs`, preserving each host's path semantics. No Windows drive path is built into runtime policy. Development runtime extraction accepts `--archive` or `DSH_DESKTOP_ASAR` on all platforms, and tests can use `DSH_TEST_RUNTIME`.

**Verification scope:** the Windows regression suite and simulated Windows/Linux/macOS path and Bash routing contracts are exercised locally. Actual Linux/macOS sandbox execution has not been verified here. Sandboxing capabilities and extra writable roots depend on the host platform. On Windows the sandbox constrains writes/deletions, not reads, network access or process visibility. Do not treat shell review exemptions as protection against secret reads or data exfiltration.

## Language and settings

The permission menu, settings, approval supplements, review page and usage display follow **DSH's selected English or Chinese UI language**. Switching languages also updates already displayed save/error notices without discarding drafts. Plugin-manager and market details use the corresponding locale metadata and packaged README. Other UI languages fall back to English. Model reasons, tool arguments and raw diagnostics are kept verbatim; timestamps and numbers use the browser's local formatting.

Open **Settings → Enhanced review** to choose:

- The session model or an existing configured provider/model; credentials remain in native Models settings.
- Reasoning: low when supported, model default, or an advertised effort for a fixed model.
- Outside-workspace actions: human approval by default, or model review.
- Native read scope: all paths by default, or workspace paths only.
- Separate failure and model-denial policies: deny by default, with optional human fallback.
- Child-agent human approval: inherit the parent policy by default, or disallow human approval without disabling model review.
- Precise deletion protection, enabled by default for actions actually sent for model review.

Default bounds are 60 seconds, 2,048 output tokens, 120,000 input characters, 100 attempts per turn and no retry. Input limits are character limits; evidence is never silently truncated. Review failures never automatically allow an action. Provider usage can be incomplete and may not match final billing.

Native spawn/fork children inherit enhanced review before their first input is released. Root human instructions remain authorization; a parent's delegated task is not elevated to new human authorization. One-time approvals and temporary escalation never become inherited permissions. Native `never` and cancellations remain binding. Related child approvals appear individually in the root conversation as well as their originating child; there is no bulk or permanent allow.

## Deletion and review records

Precise deletion protection asks the reviewer to check resolved targets, the entire deletion scope and matching prior observations. Narrow, verified and authorized deletions may pass. Insufficient evidence must be denied. This is model policy, not an operating-system deletion block. Workspace operations exempt from model review do not receive this deletion check.

The **Review** conversation tab shows persistent records for actual model reviews, including complete arguments, model verdicts, final gate outcomes, retries and reported usage. The separate **Review usage** control beside native token usage summarizes this session only. Native token usage does not include these independent review streams. Exempt operations and human-only approvals do not create model review records.

History is stored locally under the profile's `.plugin-data/dsh-auto-review-desktop/history/`. **It contains complete tool arguments and model denial reasons, which may include sensitive task data. It currently has no automatic rotation.** It does not copy entire conversation messages, establish authorization, or travel with an exported/forked conversation. Before uninstalling, use **Settings → Enhanced review → Danger zone → Clear local data**. Preview the fixed directories and enter `DELETE` within one minute. This stops enhanced review and persistence, then erases this profile's plugin history and rotating journal; it preserves configuration, credentials, conversations and other plugins. A reserved `.auto-review-desktop-cleanup/` directory under the profile root stages removal and is included in a retry preview after an interrupted deletion. Stop other DSH instances using this profile first. Failed shutdown or removal is reported as a failure; data may remain and the plugin must be reloaded before enhanced review is used again. Removing the plugin directly does not erase history.

A separate rotating `reviews.<pid>.jsonl` journal under `.plugin-data/dsh-auto-review-desktop/` contains correlation IDs, model, tool name, timing, outcomes and reported usage, but omits arguments, conversation text and reasons. Read-only history RPC requires an authenticated owner.

## Install, disable and release

Install the built `.tgz` through DSH's plugin manager using **Local package**. The archive includes its client bundle, locales, icon, licenses and documentation; it has no install/postinstall scripts or bundled React. Refresh the existing DSH page after applying the update. The package supports DSH 0.2.0 or later.

Before disabling, uninstalling or updating, stop enhanced sessions' work. Hot unloading cancels active enhanced runs and queues, then downgrades loaded enhanced sessions to `workspace-write/ask`; ordinary application shutdown preserves the saved mode. After a hot reload, select the desired permission mode again and continue. Unloaded historical sessions are not rewritten.

See [development instructions](development.zh.md) for build and tests and [release instructions](release.zh.md) for npm publishing, pinned Git releases and the separate market-index submission step. Publishing to npm alone does not list a plugin in DSH's configured market indexes. This repository has not been automatically published by the compatibility check.
