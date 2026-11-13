/* Native DSH Desktop client bundle. React is supplied by the existing module loader. */
window.__ModuleLoader__.load({
  id: 'dsh-auto-review-desktop',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useEffect, useRef, useSyncExternalStore, cloneElement, isValidElement, Children } = React;
    const { Menu, PermissionIconAutoReviewRegular } = require('@deepseek-ai/dsh-client-ui-primitives');
    const NS = 'autoReviewDesktop';
    const FIELDS = ['routeMode', 'provider', 'model', 'reasoningMode', 'reasoningEffort', 'timeoutMs', 'maxOutputTokens', 'maxInputChars', 'maxReviewsPerTurn', 'maxRetries', 'failurePolicy', 'preciseDeletion', 'workspaceEscalation', 'denialPolicy', 'subagentApproval', 'workspaceReads'];
    const DEFAULTS = { routeMode: 'follow', provider: '', model: '', reasoningMode: 'low', reasoningEffort: '', timeoutMs: 60000, maxOutputTokens: 2048, maxInputChars: 120000, maxReviewsPerTurn: 100, maxRetries: 0, failurePolicy: 'deny', preciseDeletion: true, workspaceEscalation: 'ask', denialPolicy: 'deny', subagentApproval: 'inherit', workspaceReads: 'allow' };
    const LIMITS = { timeoutMs: [1000, 180000], maxOutputTokens: [256, 16384], maxInputChars: [4000, 1000000], maxReviewsPerTurn: [1, 1000], maxRetries: [0, 1] };
    const en = {
      permissionFullLabel: 'Auto review (Full access)', permissionWorkspaceLabel: 'Auto review (Workspace)',
      permissionFullBadge: 'ENHANCED', permissionWorkspaceBadge: 'ENHANCED',
      permissionFullDescription: 'Review each action with your configured model while running without a sandbox. Uses additional tokens.',
      permissionWorkspaceDescription: 'Sandbox-confined work and configured native read-only operations skip review; other actions use configured approval.',
      // Backward-compatible aliases for callers that used the single-mode copy.
      permissionLabel: 'Auto review (Full access)', permissionBadge: 'ENHANCED', permissionDescription: 'Review each action with your configured model while running without a sandbox. Uses additional tokens.',
      nav: 'Enhanced review', title: 'Enhanced review', intro: 'Choose the model and limits for automatic authorization review.',
      scope: 'Profile setting · Applies to both Auto review modes. Saving does not switch modes.',
      loading: 'Loading review settings…', unavailable: 'Review settings are unavailable.', readOnly: 'This profile is read-only. Settings cannot be saved.',
      route: 'Review model', follow: 'Follow the session model', specific: 'Use a configured model',
      followHelp: 'Each review uses that session’s current provider and model.',
      specificHelp: 'Uses an existing configured route. API credentials remain in Models settings.',
      model: 'Configured model', chooseModel: 'Choose a model', search: 'Filter configured models', noModels: 'No matching configured models.',
      modelLoading: 'Loading configured models…', modelFailure: 'Could not load the model catalog.', retryModels: 'Reload models',
      missingModel: 'The saved model is not in the current catalog. Reload models or choose an available route before saving.',
      modelFailures: 'Some providers could not load:', reasoning: 'Reasoning effort', low: 'Low when supported', modelDefault: 'Model default', effortSpecific: 'Choose an advertised effort', effort: 'Effort',
      lowHelp: 'Uses low reasoning when the selected model supports it; otherwise uses the model default.',
      effortMissing: 'Choose an effort advertised by the selected model.', followEffort: 'Choose a fixed model first to select a specific effort.',
      limits: 'Review limits', timeoutMs: 'Timeout (milliseconds)', maxOutputTokens: 'Maximum output tokens', maxInputChars: 'Maximum input characters',
      maxReviewsPerTurn: 'Reviews per turn', maxRetries: 'Retries per review', retryNone: 'No retry', retryOnce: 'One retry',
      inputHelp: 'Characters, not tokens. Exceeding a limit follows the failure policy instead of silently trimming authorization evidence.',
      failurePolicy: 'When review cannot complete', deny: 'Deny the action', ask: 'Ask for human approval',
      failureHelp: 'A timeout, invalid response, unavailable model, or exhausted budget follows this policy. Review failures never automatically allow an action.',
      denialPolicy: 'When the model denies an action', denialHelp: 'Deny by default. Human fallback asks about this exact action and remains subject to the session approval policy.',
      subagentApproval: 'Human approval for child agents', subagentInherit: 'Inherit the parent policy', subagentDeny: 'Disallow human approval',
      subagentHelp: 'Ordinary child agents inherit enhanced review. This setting only controls human approval; it does not disable model review. Requests appear in the originating child and in its root conversation.',
      invalidDecisionPolicy: 'Choose deny or human approval.', invalidSubagentApproval: 'Choose inherit or disallow human approval.',
      childApprovals: 'Child-agent approvals ({count})', childApprovalsHelp: 'Listed in the order received. Each decision applies only to its original request. Requests hidden before this panel loaded appear when the native UI reveals them.',
      childApprovalDetails: 'Original action and reason', childApprovalArguments: 'Complete tool arguments', childApprovalReason: 'Approval reason', childApprovalAllow: 'Allow once', childApprovalReject: 'Reject',
      childApprovalLoading: 'Loading the original tool call…', childApprovalMissing: 'The original tool call could not be verified. Open the child conversation to inspect it.', childApprovalRetry: 'Reload action details', childApprovalFailed: 'Could not answer this request.',
      childApprovalNoCall: 'This request has no correlated tool call; inspect it in the child conversation.',
      save: 'Save settings', saving: 'Saving…', saved: 'Saved. Future reviews use these profile settings.', unsaved: 'Unsaved changes', clean: 'Saved configuration',
      saveFailed: 'Save failed. Host settings were reloaded; your draft is kept. Reload the saved settings before retrying if another editor changed them.',
      reload: 'Reload saved settings', reloadAll: 'Reload settings', reloading: 'Reloading…', reloadFailed: 'Could not reload settings.',
      conflict: 'Settings changed elsewhere. Reload saved settings to avoid overwriting that change.',
      invalidNumber: 'Enter a whole number from {min} to {max}.', invalidBoolean: 'Choose an enabled or disabled state.', modelRequired: 'Choose an available configured model.',
      preciseDeletion: 'Precise deletion protection',
      preciseDeletionHelp: 'Enabled by default for Full access actions and Workspace actions sent for model review. Workspace operations that skip review do not receive deletion review. Review must verify resolved targets and scope; insufficient evidence must not be automatically approved. This is a model policy, not an operating-system deletion block.',
      workspaceEscalation: 'Outside-workspace actions', workspaceAsk: 'Human approval (default)', workspaceReview: 'Model review',
      workspaceEscalationHelp: 'Only controls outside-workspace actions and permission escalation in Workspace mode. Full access still reviews every action. Approval applies once and does not change the session mode. A model denial stays denied unless human fallback is explicitly enabled. The sandbox does not provide operating-system isolation for network access or reads.',
      invalidWorkspaceEscalation: 'Choose human approval or model review.',
      workspaceReads: 'Native read-only scope', workspaceReadsAllow: 'All paths (default)', workspaceReadsApprove: 'Workspace paths only',
      workspaceReadsHelp: 'In Workspace mode, native read, read_image, glob and grep skip review on all paths by default. Choose workspace paths only to send outside reads through the outside-workspace policy. Unknown and MCP tools do not automatically skip review.',
      invalidWorkspaceReads: 'Choose all paths or workspace paths only.',
      approvalDetails: 'Exact action details', approvalTool: 'Tool', approvalCall: 'Call ID', approvalMissing: 'The complete original action could not be retrieved. Do not infer the action from a generic approval reason.', approvalLoading: 'Loading the complete original action…', approvalWithdrawn: 'This approval request has ended.',
      pendingLoad: 'Wait for settings to finish loading.',
      usageTitle: 'Review usage', usageScope: 'This Host run only · Counts reset when the Host restarts. Loaded once when this page opens; refresh manually for the latest counts.',
      usageLoading: 'Loading review usage…', usageRefresh: 'Refresh usage', usageFailure: 'Could not load review usage.', usageInvalid: 'The Host returned an unsupported usage response.',
      usageUnknown: 'Unknown', usageAttempts: 'Review attempts', usageAllows: 'Reviewer allows', usageDenies: 'Reviewer denies', usageFailures: 'Failed', usageCancelled: 'Cancelled',
      usageInput: 'Input tokens', usageOutput: 'Output tokens', usageCache: 'Cache-read tokens', usageReported: 'Attempts reporting usage',
      usageNote: 'Each token total sums only attempts that reported that field and may be partial. Unreported fields are unknown. Reasoning may already be included in output tokens and must not be added again. Reviewer allows/denies describe model verdicts; tools must still pass other permission checks.',
      reviewPassed: 'Review passed', review_reviewing: 'Reviewing action…', review_allowed: 'Model allowed', review_denied: 'Auto review denied this action', review_failed: 'Auto review failed', review_interrupted: 'Review interrupted',
      reviewNoReason: 'The reviewer did not provide a reason.', reviewHumanFallback: 'Sent for human approval; the model denial remains recorded.', reviewAllowNote: 'Model verdict only; execution remains subject to other checks.',
      reviewTab: 'Review trace', reviewInspect: 'Inspect call', reviewHistory: 'Automatic reviews', reviewHistoryHelp: 'Per-call reviewer verdicts and final gate results. Expand a record for model, risk, reason, timing, retries and reported usage. Reasons are the returned decision text, not hidden model reasoning.',
      reviewHistoryLoading: 'Loading review history…', reviewHistoryEmpty: 'No recorded model reviews for this session. Workspace exemptions and human-only approvals do not create model reviews. Reviews before this version are unavailable.',
      reviewFilter: 'Filter tool or call ID', reviewOriginalCall: 'Root call ID', reviewGate: 'Final review gate', reviewGatePending: 'Pending', reviewGate_allow: 'Passed review gate', reviewGate_deny: 'Blocked', reviewGate_ask: 'Human approval requested', reviewGate_cancel: 'Cancelled',
      reviewLoadFailed: 'Review display could not connect. No conclusion can be inferred.', reviewReload: 'Reconnect', reviewMemoryOnly: 'History storage is unavailable; records may be limited to this Host run.',
      usageAuditUnavailable: 'Audit storage is unavailable. These in-memory counts still cover this Host run.', usageStopped: 'The review service is not running.',
    };
    const zh = {
      permissionFullLabel: '自动审查（完全访问）', permissionWorkspaceLabel: '自动审查（工作区）',
      permissionFullBadge: '增强', permissionWorkspaceBadge: '增强',
      permissionFullDescription: '无沙箱运行，按配置的模型逐次审查，会消耗额外 token。',
      permissionWorkspaceDescription: '沙箱约束内的操作免审；设定范围的原生只读操作也免审，其他动作按设置审批。',
      permissionLabel: '自动审查（完全访问）', permissionBadge: '增强', permissionDescription: '无沙箱运行，按配置的模型逐次审查，会消耗额外 token。',
      nav: '增强审查', title: '增强审查', intro: '选择自动授权审查使用的模型与运行限额。',
      scope: '作用范围：当前配置档案 · 同时用于两种自动审查模式。保存设置不会切换会话模式。',
      loading: '正在读取审查设置…', unavailable: '审查设置当前不可用。', readOnly: '当前配置档案只读，无法保存设置。',
      route: '审查模型', follow: '跟随会话模型', specific: '使用已配置的模型',
      followHelp: '每次审查沿用该会话当前的提供方和模型。',
      specificHelp: '复用现有模型配置；API 凭据仍由“模型”设置管理。',
      model: '已配置模型', chooseModel: '请选择模型', search: '筛选已配置模型', noModels: '没有匹配的已配置模型。',
      modelLoading: '正在读取已配置模型…', modelFailure: '模型目录读取失败。', retryModels: '重新读取模型',
      missingModel: '已保存的模型不在当前目录中。请重新读取模型，或选择可用模型后保存。',
      modelFailures: '部分提供方读取失败：', reasoning: '推理强度', low: '支持时使用低强度', modelDefault: '模型默认', effortSpecific: '选择模型提供的强度', effort: '推理等级',
      lowHelp: '模型支持时使用低推理强度；不支持时使用模型默认值。',
      effortMissing: '请选择所选模型实际提供的推理等级。', followEffort: '选择固定审查模型后，才能指定该模型的推理等级。',
      limits: '审查限额', timeoutMs: '超时（毫秒）', maxOutputTokens: '最大输出 token', maxInputChars: '最大输入字符数',
      maxReviewsPerTurn: '每轮审查次数', maxRetries: '每次审查重试次数', retryNone: '不重试', retryOnce: '重试一次',
      inputHelp: '这里限制的是字符数，不是 token。超限时按失败策略处理，不会静默裁剪授权依据。',
      failurePolicy: '审查无法完成时', deny: '拒绝操作', ask: '交由人工审批',
      failureHelp: '超时、响应无效、模型不可用或预算耗尽时按此策略处理。审查失败不会自动放行。',
      denialPolicy: '模型拒绝操作时', denialHelp: '默认直接拒绝。选择人工回退后，仅询问这一次具体操作，仍须遵守会话的人工审批策略。',
      subagentApproval: '子代理人工审批', subagentInherit: '继承父代理策略', subagentDeny: '禁止人工审批',
      subagentHelp: '普通子代理继承增强审查。本项只控制人工审批，不关闭模型审查。请求同时保留在原子会话，并汇总到所属主会话。',
      invalidDecisionPolicy: '请选择拒绝操作或人工审批。', invalidSubagentApproval: '请选择继承父策略或禁止人工审批。',
      childApprovals: '子代理待审批（{count}）', childApprovalsHelp: '按收到顺序列出，每次决定只作用于原请求。面板载入前被原生界面暂时遮住的请求，会在原生界面重新显示后补入。',
      childApprovalDetails: '原始操作及审批理由', childApprovalArguments: '完整工具参数', childApprovalReason: '审批理由', childApprovalAllow: '允许一次', childApprovalReject: '拒绝',
      childApprovalLoading: '正在读取原始工具调用…', childApprovalMissing: '无法核实原始工具调用，请打开子会话查看。', childApprovalRetry: '重新读取操作详情', childApprovalFailed: '审批答复失败。',
      childApprovalNoCall: '请求没有关联工具调用，请在子会话内核实。',
      save: '保存设置', saving: '正在保存…', saved: '已保存。后续审查将使用这些配置。', unsaved: '有未保存修改', clean: '已保存的配置',
      saveFailed: '保存失败。已重新读取服务端设置，当前草稿仍保留；若其他编辑器修改了设置，请先重新载入已保存设置。',
      reload: '重新载入已保存设置', reloadAll: '重新读取设置', reloading: '正在重新读取…', reloadFailed: '重新读取设置失败。',
      conflict: '设置已在其他位置修改。请重新载入已保存设置，避免覆盖该修改。',
      invalidNumber: '请输入 {min} 至 {max} 之间的整数。', invalidBoolean: '请选择开启或关闭状态。', modelRequired: '请选择当前可用的已配置模型。',
      preciseDeletion: '精确删除保护',
      preciseDeletionHelp: '默认开启，用于完全访问模式及工作区模式中送交模型审查的动作。工作区免审操作不经过删除审查。审查须核实解析后的目标与范围，证据不足时不得自动批准。这是模型策略，而非操作系统删除拦截。',
      workspaceEscalation: '工作区外操作', workspaceAsk: '人工审批（默认）', workspaceReview: '模型审查',
      workspaceEscalationHelp: '仅配置工作区模式的外部动作及提权处理；完全访问模式仍逐次送审。批准只针对本次操作，不改变会话模式。模型拒绝默认直接生效，仅在显式启用人工回退后才询问用户。沙箱对网络访问和读取并非操作系统级隔离。',
      invalidWorkspaceEscalation: '请选择人工审批或模型审查。',
      workspaceReads: '原生只读范围', workspaceReadsAllow: '全部路径（默认）', workspaceReadsApprove: '仅工作区内',
      workspaceReadsHelp: '工作区模式默认允许原生 read、read_image、glob、grep 在全部路径免审。选择仅工作区内后，外部读取按工作区外操作策略处理。未知工具和 MCP 工具不会自动免审。',
      invalidWorkspaceReads: '请选择全部路径或仅工作区内。',
      approvalDetails: '具体操作详情', approvalTool: '工具', approvalCall: '调用 ID', approvalMissing: '无法取得完整原始操作，请勿根据通用审批理由推测动作。', approvalLoading: '正在读取完整原始操作…', approvalWithdrawn: '此审批请求已结束。',
      pendingLoad: '请等待设置读取完成。',
      usageTitle: '审查用量', usageScope: '仅统计本次服务运行，服务重启后归零。打开页面时读取一次；可手动刷新查看最新计数。',
      usageLoading: '正在读取审查用量…', usageRefresh: '刷新用量', usageFailure: '审查用量读取失败。', usageInvalid: '服务端返回了不支持的用量格式。',
      usageUnknown: '未知', usageAttempts: '审查尝试', usageAllows: '模型允许', usageDenies: '模型拒绝', usageFailures: '失败', usageCancelled: '取消',
      usageInput: '输入 token', usageOutput: '输出 token', usageCache: '缓存读取 token', usageReported: '已报告用量的尝试',
      usageNote: '各项 token 仅汇总报告了该字段的尝试，可能只覆盖部分审查；未报告的字段未知。推理 token 可能已计入输出 token，不能重复相加。模型允许／拒绝仅表示审查模型的判定，实际工具仍须通过其他权限检查。',
      reviewPassed: '审查通过', review_reviewing: '正在审查操作…', review_allowed: '模型允许', review_denied: '自动审查拒绝了此操作', review_failed: '自动审查失败', review_interrupted: '审查已中断',
      reviewNoReason: '审查模型未提供拒绝理由。', reviewHumanFallback: '已转交人工审批，模型的拒绝结论仍保留。', reviewAllowNote: '仅表示模型判定允许，执行仍须通过其他检查。',
      reviewTab: '审查轨迹', reviewInspect: '查看调用', reviewHistory: '自动审查记录', reviewHistoryHelp: '逐调用展示模型结论和最终审查门结果。展开记录可查看模型、风险、理由、耗时、重试及已报告用量。理由是模型返回的判定文本，不含隐藏推理。',
      reviewHistoryLoading: '正在读取审查记录…', reviewHistoryEmpty: '此会话没有已记录的模型审查。工作区免审及仅人工审批不会产生模型审查记录；升级前的审查无法补录。',
      reviewFilter: '筛选工具或调用 ID', reviewOriginalCall: '根调用 ID', reviewGate: '最终审查门结果', reviewGatePending: '待完成', reviewGate_allow: '通过审查门', reviewGate_deny: '已阻断', reviewGate_ask: '已请求人工审批', reviewGate_cancel: '已取消',
      reviewLoadFailed: '审查展示连接失败，不能据此推断审查结论。', reviewReload: '重新连接', reviewMemoryOnly: '历史存储不可用，记录可能仅覆盖本次服务运行。',
      usageAuditUnavailable: '审计存储当前不可用，仍显示本次运行的内存计数。', usageStopped: '审查服务当前未运行。',
    };

    function draftOf(value) {
      return Object.fromEntries(FIELDS.map(key => [key, value?.[key] ?? DEFAULTS[key]]));
    }
    function sameDraft(a, b) {
      return a !== null && b !== null && FIELDS.every(key => a[key] === b[key]);
    }
    function modelChoices(catalog) {
      return (catalog?.groups ?? []).flatMap(group => (group.models ?? []).map(model => ({
        key: JSON.stringify([group.id, model.id]), provider: group.id, providerName: group.name ?? group.id, model,
      })));
    }
    function validateDraft(draft, choices) {
      const errors = {};
      if (typeof draft.preciseDeletion !== 'boolean') errors.preciseDeletion = 'invalidBoolean';
      if (!['allow', 'approve'].includes(draft.workspaceReads)) errors.workspaceReads = 'invalidWorkspaceReads';
      if (!['ask', 'review'].includes(draft.workspaceEscalation)) errors.workspaceEscalation = 'invalidWorkspaceEscalation';
      if (!['deny', 'ask'].includes(draft.denialPolicy)) errors.denialPolicy = 'invalidDecisionPolicy';
      if (!['inherit', 'deny'].includes(draft.subagentApproval)) errors.subagentApproval = 'invalidSubagentApproval';
      if (draft.routeMode === 'specific' && !choices.some(choice => choice.provider === draft.provider && choice.model.id === draft.model)) errors.model = 'modelRequired';
      const picked = choices.find(choice => choice.provider === draft.provider && choice.model.id === draft.model);
      if (draft.reasoningMode === 'specific' && (draft.routeMode !== 'specific' || !picked?.model.reasoning?.efforts?.some(effort => effort.id === draft.reasoningEffort))) errors.reasoningEffort = 'effortMissing';
      for (const [key, [min, max]] of Object.entries(LIMITS)) {
        if (typeof draft[key] !== 'number' || !Number.isSafeInteger(draft[key]) || draft[key] < min || draft[key] > max) errors[key] = { min, max };
      }
      return errors;
    }
    function installStyles() {
      if (document.getElementById('auto-review-desktop-styles')) return () => {};
      const style = document.createElement('style');
      style.id = 'auto-review-desktop-styles';
      style.textContent = `
.ar-permission-label{display:flex;flex-direction:column;gap:3px;max-width:290px;white-space:normal;padding:2px 0}
.ar-permission-heading{display:inline-flex;align-items:center;gap:5px;font:inherit;line-height:20px}
.ar-permission-badge{flex:none;color:var(--dsw-alias-label-tertiary);font-size:8px;font-weight:500;line-height:10px;letter-spacing:.2px}
.ar-permission-description{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
.ar-permission-trigger-icon{display:inline-flex;flex:none;align-items:center}
.ar-permission-trigger-icon svg{width:14px;height:14px}
@container (width<=460px){[data-auto-review-permission]>span:not(.ar-permission-trigger-icon):not(:last-child){display:none}}
[data-auto-review-settings]{max-width:720px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:16px;font-size:14px;line-height:1.55}
[data-auto-review-settings] *{box-sizing:border-box}
[data-auto-review-settings] h2{font-size:16px;font-weight:500;line-height:24px;margin:0}
[data-auto-review-settings] h3{font-size:14px;font-weight:500;margin:0 0 12px}
[data-auto-review-settings] p{margin:0}
[data-auto-review-settings] .ar-help{color:var(--dsw-alias-label-tertiary);font-size:12px}
[data-auto-review-settings] .ar-card{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl,12px);padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}
[data-auto-review-settings] .ar-field{display:flex;flex-direction:column;gap:6px;min-width:0}
[data-auto-review-settings] .ar-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
[data-auto-review-settings] input,[data-auto-review-settings] select{width:100%;min-width:0;height:36px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:6px 10px;font:inherit}
[data-auto-review-settings] input[type=checkbox]{width:16px;height:16px;min-width:16px;padding:0;margin:0;align-self:flex-start;accent-color:var(--dsw-alias-state-business-primary)}
[data-auto-review-settings] input:focus-visible,[data-auto-review-settings] select:focus-visible,[data-auto-review-settings] button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
[data-auto-review-settings] input[aria-invalid=true],[data-auto-review-settings] select[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}
[data-auto-review-settings] button{font:inherit;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);padding:7px 12px;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-settings-card-fill)}
[data-auto-review-settings] button.ar-primary{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-oncolor,#fff);border-color:transparent}
[data-auto-review-settings] button:disabled,[data-auto-review-settings] input:disabled,[data-auto-review-settings] select:disabled{opacity:.5;cursor:default}
[data-auto-review-settings] .ar-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
[data-auto-review-settings] .ar-actions h3{margin:0;flex:1}
[data-auto-review-settings] .ar-usage-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0}
[data-auto-review-settings] .ar-usage-grid dt{color:var(--dsw-alias-label-tertiary);font-size:12px}
[data-auto-review-settings] .ar-usage-grid dd{margin:2px 0 0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
[data-auto-review-settings] .ar-error{color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}
[data-auto-review-settings] .ar-warning{color:var(--dsw-alias-state-warn-label);font-size:12px;overflow-wrap:anywhere}
[data-auto-review-settings] .ar-success{color:var(--dsw-alias-state-success-primary);font-size:12px}
[data-auto-review-settings] .ar-sr{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:640px){[data-auto-review-settings] .ar-grid{grid-template-columns:minmax(0,1fr)}}
.ar-child-approvals{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-chat-content-width);margin:6px auto;padding:12px;border:1px solid var(--dsw-alias-state-warn-secondary);border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.ar-child-approvals h3{font-size:14px;margin:0 0 6px}.ar-child-approvals p{margin:4px 0}.ar-child-approvals .ar-help{color:var(--dsw-alias-label-tertiary);font-size:12px}.ar-child-approvals ol{margin:8px 0 0;padding:0;list-style:none;max-height:340px;overflow-y:auto}.ar-child-approvals li{border-top:1px solid var(--dsw-alias-border-l2);padding:10px 0}.ar-child-approvals code{overflow-wrap:anywhere}.ar-child-approvals summary{cursor:pointer;margin:6px 0}.ar-child-approvals pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;padding:8px;background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-md);font:12px/18px var(--ds-font-family-code,monospace)}
.ar-child-approvals .ar-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.ar-child-approvals button{font:inherit;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);cursor:pointer}.ar-child-approvals .ar-primary{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-oncolor)}.ar-child-approvals button:disabled{opacity:.5;cursor:default}.ar-child-approvals button:focus-visible,.ar-child-approvals summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.ar-child-approvals .ar-error{color:var(--dsw-alias-state-error-primary)}\n.ar-approval-detail{display:flex;flex-direction:column;gap:6px;min-width:0}.ar-approval-detail p{margin:0}.ar-approval-detail pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-family:var(--ds-font-family-code);font-size:12px;line-height:1.5}.ar-approval-detail button{align-self:flex-start}
.ar-review-connection{width:calc(100% - 32px);max-width:var(--dsh-chat-content-width);margin:0 auto;font-size:12px;line-height:18px}
.ar-review-standalone{flex:1;max-height:none;min-height:0;height:100%;box-sizing:border-box;overflow:auto}
.ar-review-notice{display:flex;align-items:flex-start;gap:8px;min-width:0;margin:5px 0 8px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;color:var(--dsw-alias-label-secondary)}
.ar-review-dot{width:6px;height:6px;flex:none;margin-top:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.ar-review-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}.ar-review-title{font-weight:500}.ar-review-reason{white-space:pre-wrap;overflow-wrap:anywhere}.ar-review-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ar-review-error{color:var(--dsw-alias-state-error-primary)}.ar-review-error .ar-review-dot{background:var(--dsw-alias-state-error-primary)}.ar-review-notice[data-review-state=allowed] .ar-review-dot{background:var(--dsw-alias-state-success-primary)}
.ar-review-code{flex:none;max-width:35%;overflow-wrap:anywhere;font-size:11px}.ar-review-link{font:inherit;font-size:12px;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;text-decoration:underline}.ar-review-link:focus-visible,.ar-review-trajectory summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ar-review-approved{align-items:center;gap:6px;margin:0 0 2px 22px;min-height:18px;font-size:11px;line-height:16px}.ar-review-approved .ar-review-dot{width:5px;height:5px;margin-top:0}.ar-review-approved .ar-review-title{font-weight:400;white-space:nowrap}.ar-review-approved .ar-review-link{margin-inline-start:auto;flex:none;white-space:nowrap;font-size:11px;line-height:16px;text-decoration:none}.ar-review-approved .ar-review-link:hover{text-decoration:underline}
.ar-review-trajectory{flex:1;max-height:none;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}.ar-review-trajectory>summary{padding:8px 16px;cursor:pointer}.ar-review-ledger{padding:0 16px 12px}.ar-review-ledger p{margin:6px 0;color:var(--dsw-alias-label-secondary)}.ar-review-ledger input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit}.ar-review-record{border-top:1px solid var(--dsw-alias-border-l1);padding:6px 0}.ar-review-record summary{cursor:pointer;overflow-wrap:anywhere}.ar-review-record pre{white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-height:300px;background:var(--dsw-alias-bg-layer-2);padding:8px;border-radius:6px;font:12px/18px monospace}.ar-review-warning{color:var(--dsw-alias-state-warn-primary)}
`;
      document.head.appendChild(style);
      return () => style.remove();
    }

    function UsageCard({ connection, t }) {
      const [state, setState] = useState({ status: 'loading', value: null, error: null });
      const pending = useRef(null);
      const load = async () => {
        pending.current?.abort();
        const controller = new AbortController();
        pending.current = controller;
        setState(previous => ({ ...previous, status: 'loading', error: null }));
        try {
          const response = await connection.rpc.call('/auto-review-desktop', 'status', {}, controller.signal);
          if (controller.signal.aborted || pending.current !== controller) return;
          if (!response.ok) throw new Error(`${response.error?.code ?? 'ERROR'}: ${response.error?.message ?? t('usageFailure')}`);
          const value = response.value;
          const fields = ['attempts', 'allows', 'denies', 'failures', 'cancelled', 'usageReported', 'inputTokens', 'outputTokens', 'cacheReadTokens'];
          if (value?.scope !== 'process' || typeof value.running !== 'boolean' || !['available', 'unavailable'].includes(value.audit) || fields.some(field => !Number.isSafeInteger(value.totals?.[field]) || value.totals[field] < 0)) throw new Error(t('usageInvalid'));
          setState({ status: 'ready', value, error: null });
        } catch (error) {
          if (controller.signal.aborted || pending.current !== controller) return;
          setState(previous => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : String(error) }));
        }
      };
      useEffect(() => {
        void load();
        return () => { pending.current?.abort(); pending.current = null; };
      }, [connection]);
      const totals = state.value?.totals;
      const format = value => value.toLocaleString();
      const tokenValue = key => state.value?.usageCoverage?.[key] > 0 ? format(totals[key]) : t('usageUnknown');
      const row = (label, value) => h('div', { key: label }, h('dt', null, t(label)), h('dd', null, value));
      return h('section', { className: 'ar-card', 'aria-labelledby': 'ar-usage-title' },
        h('div', { className: 'ar-actions' }, h('h3', { id: 'ar-usage-title' }, t('usageTitle')),
          h('button', { id: 'ar-usage-refresh', type: 'button', disabled: state.status === 'loading', onClick: () => void load() }, t('usageRefresh'))),
        h('p', { className: 'ar-help' }, t('usageScope')),
        state.status === 'loading' ? h('p', { className: 'ar-help', role: 'status' }, t('usageLoading')) : null,
        state.error ? h('p', { className: 'ar-error', role: 'alert' }, `${t('usageFailure')} ${state.error}`) : null,
        totals ? h('dl', { className: 'ar-usage-grid' },
          row('usageAttempts', format(totals.attempts)), row('usageAllows', format(totals.allows)),
          row('usageDenies', format(totals.denies)), row('usageFailures', format(totals.failures)), row('usageCancelled', format(totals.cancelled)),
          row('usageInput', tokenValue('inputTokens')), row('usageOutput', tokenValue('outputTokens')), row('usageCache', tokenValue('cacheReadTokens')),
          row('usageReported', `${format(totals.usageReported)} / ${format(totals.attempts)}`),
        ) : null,
        state.value?.running === false ? h('p', { className: 'ar-warning' }, t('usageStopped')) : null,
        state.value?.audit === 'unavailable' ? h('p', { className: 'ar-warning' }, t('usageAuditUnavailable')) : null,
        h('p', { className: 'ar-help' }, t('usageNote')),
      );
    }

    function SettingsSection({ form, mirror, catalog, connection, t }) {
      const snapshot = useSyncExternalStore(fn => form.subscribe(fn), () => form.getSnapshot());
      const mirrored = useSyncExternalStore(fn => mirror.subscribe(fn), () => mirror.getSnapshot());
      const models = useSyncExternalStore(fn => catalog.store.subscribe(fn), () => catalog.store.getSnapshot());
      const [draft, setDraft] = useState(null);
      const [base, setBase] = useState(null);
      const [revision, setRevision] = useState(undefined);
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState(null);
      const [query, setQuery] = useState('');
      const dirty = draft !== null && !sameDraft(draft, base);
      const conflict = revision !== undefined && snapshot.revision !== undefined && revision !== snapshot.revision;
      useEffect(() => {
        catalog.load().catch(() => {});
      }, [catalog]);
      useEffect(() => {
        if (snapshot.status === 'ready' && snapshot.value !== undefined && !dirty && !busy) {
          const next = draftOf(snapshot.value);
          setDraft(next); setBase(next); setRevision(snapshot.revision);
        }
      }, [snapshot.value, snapshot.revision, snapshot.status, dirty, busy]);
      const choices = modelChoices(models.value);
      const picked = draft === null ? undefined : choices.find(choice => choice.provider === draft.provider && choice.model.id === draft.model);
      const errors = draft === null ? {} : validateDraft(draft, choices);
      const disabled = busy || !snapshot.writable;
      const update = (key, value) => {
        setDraft(previous => ({ ...previous, [key]: value }));
        setNotice(null);
      };
      const reload = async () => {
        setBusy(true); setNotice(null);
        try {
          await mirror.load();
          if (mirror.getSnapshot().status !== 'ready' || mirror.getSnapshot().error) throw new Error(mirror.getSnapshot().error || t('reloadFailed'));
          const latest = form.getSnapshot();
          if (latest.status !== 'ready' || latest.value === undefined) throw new Error(t('unavailable'));
          const next = draftOf(latest.value);
          setDraft(next); setBase(next); setRevision(latest.revision);
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('reloadFailed')} ${error instanceof Error ? error.message : String(error)}` });
        } finally { setBusy(false); }
      };
      const save = async event => {
        event.preventDefault();
        if (busy || draft === null || !snapshot.writable || !dirty) return;
        if (conflict || snapshot.revision !== revision) { setNotice({ kind: 'error', text: t('conflict') }); return; }
        if (Object.keys(validateDraft(draft, modelChoices(catalog.store.getSnapshot().value))).length > 0) return;
        const savedDraft = { ...draft };
        const ops = FIELDS.filter(key => savedDraft[key] !== base[key]).map(key => ({ op: 'set', path: [key], value: savedDraft[key] }));
        setBusy(true); setNotice(null);
        try {
          const accepted = await form.mutate(ops, revision);
          if (!accepted) { setNotice({ kind: 'error', text: t('saveFailed') }); return; }
          const latest = form.getSnapshot();
          const next = draftOf(latest.value ?? savedDraft);
          setDraft(next); setBase(next); setRevision(latest.revision);
          setNotice({ kind: 'success', text: t('saved') });
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')} ${error instanceof Error ? error.message : String(error)}` });
        } finally { setBusy(false); }
      };
      const help = text => h('p', { className: 'ar-help' }, text);
      const option = (value, label, extra = {}) => h('option', { key: value, value, ...extra }, label);
      const field = (label, control, hint, error, id) => h('div', { className: 'ar-field', key: id },
        h('label', { htmlFor: id }, label), control,
        hint ? h('p', { className: 'ar-help', id: `${id}-help` }, hint) : null,
        error ? h('p', { className: 'ar-error', id: `${id}-error`, role: 'alert' }, typeof error === 'string' ? t(error) : t('invalidNumber', error)) : null);
      const select = (key, options, onChange, extra = {}) => h('select', {
        id: `ar-${key}`, value: draft?.[key] ?? '', disabled,
        onChange: event => onChange ? onChange(event.target.value) : update(key, event.target.value), ...extra,
      }, options);
      const number = key => field(t(key), h('input', {
        id: `ar-${key}`, type: 'number', inputMode: 'numeric', step: 1, min: LIMITS[key][0], max: LIMITS[key][1],
        value: draft[key], disabled, 'aria-invalid': errors[key] ? true : undefined,
        'aria-describedby': errors[key] ? `ar-${key}-error` : undefined,
        onChange: event => update(key, event.target.value === '' ? '' : Number(event.target.value)),
      }), null, errors[key], `ar-${key}`);
      const loadError = mirrored.error;
      if (draft === null || snapshot.status !== 'ready') return h('section', { 'data-auto-review-settings': '', 'aria-labelledby': 'ar-title' },
        h('h2', { id: 'ar-title' }, t('title')), help(t('scope')), h(UsageCard, { connection, t }),
        h('p', { role: loadError ? 'alert' : 'status', className: loadError ? 'ar-error' : 'ar-help' }, loadError ? `${t('unavailable')} ${String(loadError)}` : t(snapshot.status === 'unavailable' ? 'unavailable' : 'loading')),
        h('button', { type: 'button', onClick: () => void reload(), disabled: busy }, t(busy ? 'reloading' : 'reloadAll')),
        notice ? h('p', { className: 'ar-error', role: 'alert' }, notice.text) : null);
      const visible = choices.filter(choice => `${choice.providerName} ${choice.provider} ${choice.model.name ?? ''} ${choice.model.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
      const groups = [...new Set(visible.map(choice => choice.provider))];
      const modelKey = JSON.stringify([draft.provider, draft.model]);
      const unknownSelected = draft.routeMode === 'specific' && draft.model !== '' && picked === undefined;
      const efforts = picked?.model.reasoning?.efforts ?? [];
      return h('form', { 'data-auto-review-settings': '', 'aria-labelledby': 'ar-title', onSubmit: save, noValidate: true },
        h('h2', { id: 'ar-title' }, t('title')), h('p', null, t('intro')), help(t('scope')), h(UsageCard, { connection, t }),
        !snapshot.writable ? h('p', { className: 'ar-warning', role: 'status' }, t('readOnly')) : null,
        loadError ? h('p', { className: 'ar-error', role: 'alert' }, `${t('reloadFailed')} ${String(loadError)}`) : null,
        conflict ? h('p', { className: 'ar-warning', role: 'alert' }, t('conflict')) : null,
        h('div', { className: 'ar-card' },
          field(t('route'), select('routeMode', [option('follow', t('follow')), option('specific', t('specific'))], value => {
            setDraft(previous => ({ ...previous, routeMode: value, ...(value === 'follow' && previous.reasoningMode === 'specific' ? { reasoningMode: 'low', reasoningEffort: '' } : {}) })); setNotice(null);
          }), t(draft.routeMode === 'follow' ? 'followHelp' : 'specificHelp'), null, 'ar-routeMode'),
          draft.routeMode === 'specific' ? h(React.Fragment, null,
            field(t('search'), h('input', { id: 'ar-model-filter', type: 'search', value: query, disabled: busy, onChange: event => setQuery(event.target.value), placeholder: t('search') }), null, null, 'ar-model-filter'),
            field(t('model'), h('select', { id: 'ar-model', value: picked || unknownSelected ? modelKey : '', disabled: disabled || models.status !== 'ready',
              'aria-invalid': errors.model ? true : undefined, 'aria-describedby': errors.model ? 'ar-model-error' : undefined,
              onChange: event => {
                const choice = choices.find(candidate => candidate.key === event.target.value);
                if (!choice) return;
                setDraft(previous => ({ ...previous, provider: choice.provider, model: choice.model.id, reasoningEffort: '', reasoningMode: previous.reasoningMode === 'specific' ? 'low' : previous.reasoningMode })); setNotice(null);
              },
            }, option('', t('chooseModel'), { disabled: true }),
              unknownSelected ? option(modelKey, `${draft.provider} / ${draft.model}`, { disabled: true }) : null,
              picked && !visible.some(choice => choice.key === picked.key) ? option(picked.key, `${picked.providerName} · ${picked.model.name ?? picked.model.id}`) : null,
              groups.map(provider => h('optgroup', { key: provider, label: visible.find(choice => choice.provider === provider).providerName }, visible.filter(choice => choice.provider === provider).map(choice => option(choice.key, choice.model.name ?? choice.model.id)))),
            ), unknownSelected ? t('missingModel') : null, errors.model, 'ar-model'),
            models.status === 'loading' || models.status === 'idle' ? help(t('modelLoading')) : null,
            models.status === 'error' ? h('p', { className: 'ar-error', role: 'alert' }, `${t('modelFailure')} ${models.error ?? ''}`) : null,
            models.status === 'ready' && visible.length === 0 ? help(t('noModels')) : null,
            (models.value?.failures?.length ?? 0) > 0 ? h('p', { className: 'ar-warning' }, `${t('modelFailures')} ${models.value.failures.map(failure => failure.name ?? failure.id).join(', ')}`) : null,
            h('div', { className: 'ar-actions' }, h('button', { type: 'button', disabled: busy || models.status === 'loading', onClick: () => catalog.refresh() }, t('retryModels'))),
          ) : null,
          field(t('reasoning'), select('reasoningMode', [option('low', t('low')), option('default', t('modelDefault')), ...(draft.routeMode === 'specific' && efforts.length > 0 || draft.reasoningMode === 'specific' ? [option('specific', t('effortSpecific'), { disabled: draft.routeMode !== 'specific' || efforts.length === 0 })] : [])]), draft.reasoningMode === 'low' ? t('lowHelp') : draft.routeMode === 'follow' ? t('followEffort') : null, null, 'ar-reasoningMode'),
          draft.reasoningMode === 'specific' ? field(t('effort'), select('reasoningEffort', [option('', t('chooseModel'), { disabled: true }), ...efforts.map(effort => option(effort.id, effort.name ?? effort.id))], null, { 'aria-invalid': errors.reasoningEffort ? true : undefined, 'aria-describedby': errors.reasoningEffort ? 'ar-reasoningEffort-error' : undefined }), null, errors.reasoningEffort, 'ar-reasoningEffort') : null,
        ),
        h('div', { className: 'ar-card' }, h('h3', null, t('limits')), h('div', { className: 'ar-grid' },
          number('timeoutMs'), number('maxOutputTokens'), number('maxInputChars'), number('maxReviewsPerTurn'),
          field(t('maxRetries'), select('maxRetries', [option('0', t('retryNone')), option('1', t('retryOnce'))], value => update('maxRetries', Number(value))), null, null, 'ar-maxRetries'),
        ), help(t('inputHelp'))),
        h('div', { className: 'ar-card' }, field(t('workspaceReads'), select('workspaceReads', [option('allow', t('workspaceReadsAllow')), option('approve', t('workspaceReadsApprove'))], null, {
          'aria-invalid': errors.workspaceReads ? true : undefined,
          'aria-describedby': `ar-workspaceReads-help${errors.workspaceReads ? ' ar-workspaceReads-error' : ''}`,
        }), t('workspaceReadsHelp'), errors.workspaceReads, 'ar-workspaceReads')),
        h('div', { className: 'ar-card' }, field(t('workspaceEscalation'), select('workspaceEscalation', [option('ask', t('workspaceAsk')), option('review', t('workspaceReview'))], null, {
          'aria-invalid': errors.workspaceEscalation ? true : undefined,
          'aria-describedby': `ar-workspaceEscalation-help${errors.workspaceEscalation ? ' ar-workspaceEscalation-error' : ''}`,
        }), t('workspaceEscalationHelp'), errors.workspaceEscalation, 'ar-workspaceEscalation')),
        h('div', { className: 'ar-card' }, field(t('preciseDeletion'), h('input', {
          id: 'ar-preciseDeletion', type: 'checkbox', checked: draft.preciseDeletion, disabled,
          'aria-invalid': errors.preciseDeletion ? true : undefined,
          'aria-describedby': `ar-preciseDeletion-help${errors.preciseDeletion ? ' ar-preciseDeletion-error' : ''}`,
          onChange: event => update('preciseDeletion', event.target.checked),
        }), t('preciseDeletionHelp'), errors.preciseDeletion, 'ar-preciseDeletion')),
        h('div', { className: 'ar-card' }, field(t('denialPolicy'), select('denialPolicy', [option('deny', t('deny')), option('ask', t('ask'))], null, {
          'aria-invalid': errors.denialPolicy ? true : undefined, 'aria-describedby': `ar-denialPolicy-help${errors.denialPolicy ? ' ar-denialPolicy-error' : ''}`,
        }), t('denialHelp'), errors.denialPolicy, 'ar-denialPolicy')),
        h('div', { className: 'ar-card' }, field(t('subagentApproval'), select('subagentApproval', [option('inherit', t('subagentInherit')), option('deny', t('subagentDeny'))], null, {
          'aria-invalid': errors.subagentApproval ? true : undefined, 'aria-describedby': `ar-subagentApproval-help${errors.subagentApproval ? ' ar-subagentApproval-error' : ''}`,
        }), t('subagentHelp'), errors.subagentApproval, 'ar-subagentApproval')),
        h('div', { className: 'ar-card' }, field(t('failurePolicy'), select('failurePolicy', [option('deny', t('deny')), option('ask', t('ask'))]), t('failureHelp'), null, 'ar-failurePolicy')),
        h('div', { className: 'ar-actions' },
          h('button', { type: 'submit', className: 'ar-primary', disabled: disabled || !dirty || conflict || Object.keys(errors).length > 0 }, t(busy ? 'saving' : 'save')),
          h('button', { type: 'button', disabled: busy, onClick: () => void reload() }, t('reload')),
          h('span', { className: 'ar-help', role: 'status' }, t(dirty ? 'unsaved' : 'clean')),
        ),
        notice ? h('p', { className: notice.kind === 'success' ? 'ar-success' : 'ar-error', role: notice.kind === 'error' ? 'alert' : 'status', 'aria-live': 'polite' }, notice.text) : null,
      );
    }

    const PERMISSION_SLOT = 'conversation.input.permission';
    const DESKTOP_PRESET = 'auto-review-desktop';
    const WORKSPACE_PRESET = 'auto-review-workspace';
    const permissionCopy = Object.freeze({
      [DESKTOP_PRESET]: ['permissionFullLabel', 'permissionFullDescription', 'permissionFullBadge'],
      [WORKSPACE_PRESET]: ['permissionWorkspaceLabel', 'permissionWorkspaceDescription', 'permissionWorkspaceBadge'],
    });
    const isReviewPreset = id => Object.hasOwn(permissionCopy, id);
    const localizedCatalogs = new WeakMap();
    function localizePermissionCatalog(catalog, t) {
      if (![...(catalog?.options ?? []), ...(catalog?.defaultOptions ?? [])].some(option => isReviewPreset(option.value))) return catalog;
      const copy = Object.fromEntries(Object.entries(permissionCopy).map(([id, [label, description]]) => [id, { name: t(label), description: t(description) }]));
      const key = JSON.stringify(copy);
      let translations = localizedCatalogs.get(catalog);
      if (!translations) localizedCatalogs.set(catalog, translations = new Map());
      if (!translations.has(key)) {
        const localize = options => options?.map(option => isReviewPreset(option.value) ? { ...option, ...copy[option.value] } : option);
        translations.set(key, { ...catalog, options: localize(catalog.options), defaultOptions: localize(catalog.defaultOptions) });
      }
      return translations.get(key);
    }
    function permissionOptionLabel(id, t) {
      const [label, description, badge] = permissionCopy[id];
      return h('span', { className: 'ar-permission-label' },
        h('span', { className: 'ar-permission-heading' },
          h('span', null, t(label)),
          h('span', { className: 'ar-permission-badge' }, t(badge))),
        h('span', { className: 'ar-permission-description' }, t(description)));
    }
    function decoratePermissionTree(node, t) {
      if (!isValidElement(node)) return node;
      if (node.type === Menu && node.props.items?.some(item => isReviewPreset(item.id))) {
        const items = node.props.items.map(item => isReviewPreset(item.id)
          ? { ...item, icon: h(PermissionIconAutoReviewRegular), label: permissionOptionLabel(item.id, t) } : item);
        let anchor = node.props.anchor;
        if (isReviewPreset(node.props.selectedId) && isValidElement(anchor)) {
          // The host owns the trigger, its handlers and the chevron. Add only our
          // glyph; the localized catalog already supplies its text and tooltip.
          anchor = cloneElement(anchor, { 'data-auto-review-permission': '' },
            h('span', { className: 'ar-permission-trigger-icon', 'aria-hidden': true }, h(PermissionIconAutoReviewRegular)),
            anchor.props.children);
        }
        return cloneElement(node, { items, anchor });
      }
      if (node.props.children === undefined) return node;
      return cloneElement(node, {}, Children.map(node.props.children, child => decoratePermissionTree(child, t)));
    }
    function registerPermissionPresentation(ctx) {
      const t = ctx.locale.bind(NS);
      return ctx.slots.inject(PERMISSION_SLOT, () => {
        let original, disposeEntry;
        const refresh = () => {
          // Stay attached to the live native contribution across plugin reloads.
          // Do not mutate its registration, module, locale, or any official option.
          const entry = ctx.slots.entries(PERMISSION_SLOT).find(item => item.locale === 'permission.access' && !isReviewPreset(item.options?.id));
          if (entry === original) return;
          disposeEntry?.(); disposeEntry = undefined; original = entry;
          if (!entry || typeof entry.component !== 'function') return;
          function DesktopPermissionPresentation(props) {
            useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot());
            const usePermissionCatalog = selector => props.usePermissionCatalog(state => selector({
              ...state, value: localizePermissionCatalog(state.value, t),
            }));
            // Host 0.2.2-rc.1 exposes this function component in the slot record.
            // Its hooks, switching logic, confirmations and other rows stay intact.
            return decoratePermissionTree(entry.component({ ...props, usePermissionCatalog }), t);
          }
          disposeEntry = ctx.slots.register({
            name: PERMISSION_SLOT, id: DESKTOP_PRESET, priority: (entry.options?.priority ?? 0) - 1,
            locale: NS, inject: entry.inject,
          }, function PermissionPresentation(props) {
            // Native labels/confirmations still need the original namespace.
            return h(DesktopPermissionPresentation, { ...props, t: ctx.locale.bind('permission.access') });
          });
        };
        const unsubscribe = ctx.slots.subscribe(PERMISSION_SLOT, refresh);
        refresh();
        return () => { unsubscribe(); disposeEntry?.(); };
      });
    }

    // Native PendingApproval owns the Remote Event promise and the one-shot answer lock.
    // Observe every publication synchronously before a later request in the same
    // Session can cover it. Never replace native pending domains or issue grants by RPC.
    function approvalRoot(sessionId, list) {
      const rows = list?.byId ?? {}, seen = new Set();
      let row = rows[sessionId];
      if (row?.origin !== 'subagent' || !row.parentId) return undefined;
      while (row?.origin === 'subagent') {
        if (!row.parentId || seen.has(row.id)) return undefined;
        seen.add(row.id); row = rows[row.parentId];
      }
      return row?.id;
    }
    function createApprovalCollector(sessions, statusSource, readCall) {
      const entries = new Map(), seen = new WeakSet(), listeners = new Set();
      let snapshot = [], active = true, order = 0;
      const publish = () => {
        if (!active) return;
        const list = sessions.list.getSnapshot();
        snapshot = [...entries.values()].filter(entry => entry.request.answerable && approvalRoot(entry.sessionId, list) === entry.rootId)
          .sort((a, b) => a.order - b.order);
        for (const listener of listeners) listener();
      };
      const remove = request => {
        const entry = entries.get(request);
        if (!entry) return;
        entry.controller?.abort(); entries.delete(request); publish();
      };
      const load = async entry => {
        entry.controller?.abort();
        const controller = new AbortController(); entry.controller = controller;
        entry.detail = { status: 'loading' }; publish();
        try {
          const call = await readCall(entry, controller.signal);
          if (!active || controller.signal.aborted || entries.get(entry.request) !== entry) return;
          entry.detail = call ? { status: 'ready', arguments: call.arguments } : { status: 'missing' };
        } catch (error) {
          if (!active || controller.signal.aborted || entries.get(entry.request) !== entry) return;
          entry.detail = { status: 'error', error: error instanceof Error ? error.message : String(error) };
        }
        publish();
      };
      const scan = () => {
        if (!active) return;
        const list = sessions.list.getSnapshot();
        for (const [sessionId, status] of statusSource.getSnapshot()) {
          const request = status.pendingInteraction;
          if (!request || request.kind !== 'approval' || !request.answerable || typeof request.answer !== 'function' || typeof request.result?.then !== 'function' || seen.has(request)) continue;
          const row = list.byId[sessionId], rootId = approvalRoot(sessionId, list);
          const permission = row?.projectionValues?.permissions?.currentValue ?? sessions.binding?.(sessionId)?.session.projections.faceOf('permissions').getSnapshot()?.currentValue;
          if (!rootId || !isReviewPreset(permission) || request.sessionId !== sessionId) continue;
          seen.add(request);
          const entry = { request, rootId, sessionId, order: ++order, key: `${sessionId}:${request.key}:${order}`, detail: { status: request.callId ? 'loading' : 'missing' }, answering: false, error: null };
          entries.set(request, entry);
          // Explicit success and rejection handlers avoid an unhandled rejection on cancellation.
          request.result.then(() => remove(request), () => remove(request));
          if (request.callId) void load(entry);
        }
        publish();
      };
      const disposeStatus = statusSource.subscribe(scan), disposeList = sessions.list.subscribe(scan);
      scan();
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        reload(entry) { if (active && entries.get(entry.request) === entry && entry.request.answerable) return load(entry); },
        async answer(entry, outcome) {
          if (!active || entries.get(entry.request) !== entry || !entry.request.answerable || entry.answering || !['allowed-once', 'rejected'].includes(outcome)) return false;
          if (approvalRoot(entry.sessionId, sessions.list.getSnapshot()) !== entry.rootId) return false;
          // Details must identify the exact original call before the aggregate can grant.
          if (outcome === 'allowed-once' && entry.detail.status !== 'ready') return false;
          entry.answering = true; entry.error = null; publish();
          try { await entry.request.answer(outcome); return true; }
          catch (error) { if (active && entries.get(entry.request) === entry && entry.request.answerable) { entry.answering = false; entry.error = error instanceof Error ? error.message : String(error); publish(); } return false; }
        },
        dispose() {
          if (!active) return; active = false; disposeStatus(); disposeList();
          for (const entry of entries.values()) entry.controller?.abort();
          entries.clear(); snapshot = []; listeners.clear();
          // Native child presentations and their approvals remain owned by ui-approval.
        },
      };
    }
    async function readApprovalCall(ctx, entry, signal) {
      const snapshot = ctx.sessions.binding(entry.sessionId)?.session.getSnapshot();
      if (snapshot?.sessionId !== entry.sessionId || !entry.request.callId) return undefined;
      const subagent = snapshot.subagent?.address;
      if (subagent && subagent.childSessionId !== entry.sessionId) return undefined;
      const address = subagent ? { kind: 'subagent', ...subagent } : { kind: 'session', sessionId: entry.sessionId };
      const page = await ctx.remote.session.events({ address, maxMessages: 200 }, signal);
      if (signal?.aborted || entry.request.answerable === false) return undefined;
      let step, calls = new Map();
      for (const { event } of page.records) {
        const data = event?.data;
        if (event?.type === 'turn/start' || event?.type === 'turn/end' || event?.type === 'step/end') {
          step = undefined; calls = new Map(); continue;
        }
        if (event?.type === 'step/start') {
          step = data; calls = new Map(); continue;
        }
        if (!step) continue;
        if (event.type === 'tool/call' && data.turn === step.turn && data.step === step.step) {
          // Duplicate call identities cannot supply approval evidence.
          calls.set(data.callId, calls.has(data.callId) ? null : { ...data, rootCallId: data.callId });
        } else if (event.type === 'tool/ptc-dispatch-start') {
          // PTC has no ordinary tool/call event or explicit turn/step fields.
          // Its earlier parent must belong to this exact open step and chain root.
          const parent = calls.get(data.parentCallId);
          const validParent = parent?.name === 'run_code' && parent.rootCallId === data.rootCallId;
          const unique = !calls.has(data.subCallId) && data.subCallId !== data.parentCallId;
          const argumentsText = data.arguments === undefined ? undefined : JSON.stringify(data.arguments);
          calls.set(data.subCallId, validParent && unique && typeof argumentsText === 'string'
            ? { ...data, callId: data.subCallId, arguments: argumentsText } : null);
        } else if (event.type === 'tool/result') {
          if (calls.has(data.message?.toolCallId)) calls.set(data.message.toolCallId, null);
        } else if (event.type === 'tool/ptc-dispatch') {
          if (calls.has(data.subCallId)) calls.set(data.subCallId, null);
        }
      }
      const call = calls.get(entry.request.callId);
      return call?.name === entry.request.toolName && typeof call.arguments === 'string' ? call : undefined;
    }
    /** Read-only detail lifetime. It never owns or answers the native approval. */
    function loadApprovalDetail(ctx, entry, publish) {
      const controller = new AbortController();
      let active = true;
      const update = value => { if (active) publish({ request: entry.request, ...value }); };
      update({ status: 'loading' });
      const withdraw = () => {
        if (!active) return;
        controller.abort(); update({ status: 'withdrawn' });
      };
      entry.request.result?.then(withdraw, withdraw);
      Promise.resolve().then(() => readApprovalCall(ctx, entry, controller.signal)).then(call => {
        if (!active || controller.signal.aborted || entry.request.answerable === false) return;
        update(call ? { status: 'ready', call } : { status: 'missing' });
      }, error => {
        if (!active || controller.signal.aborted || entry.request.answerable === false) return;
        update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      });
      return () => { active = false; controller.abort(); };
    }
    function ApprovalDetailBody({ request, detail, t, retry }) {
      return h('section', { className: 'ar-approval-detail', 'aria-label': t('approvalDetails'), 'data-approval-call': request.callId },
        h('p', null, t('approvalTool'), ': ', h('code', null, request.toolName)),
        h('p', null, t('approvalCall'), ': ', h('code', null, request.callId)),
        detail.status === 'ready' ? h(React.Fragment, null, h('p', null, t('childApprovalArguments')), h('pre', null, detail.call.arguments))
          : h('p', { role: detail.status === 'loading' ? 'status' : undefined }, t(detail.status === 'loading' ? 'approvalLoading' : detail.status === 'withdrawn' ? 'approvalWithdrawn' : 'approvalMissing')),
        detail.error ? h('p', { role: 'alert' }, detail.error) : null,
        ['missing', 'error'].includes(detail.status) ? h('button', { type: 'button', onClick: retry }, t('childApprovalRetry')) : null);
    }
    function NativeApprovalDetail({ context, request, sessionId, callId, t }) {
      const [detail, setDetail] = useState({ status: 'loading' });
      const [revision, setRevision] = useState(0);
      useEffect(() => loadApprovalDetail(context, { sessionId, request }, setDetail), [context, sessionId, request, callId, revision]);
      // A new native request must never briefly show the previous request's args.
      return h(ApprovalDetailBody, { request, detail: detail.request === request ? detail : { status: 'loading' }, t, retry: () => setRevision(value => value + 1) });
    }
    function registerApprovalDetails(ctx) {
      return ctx.inject(['sessions', 'uiSession', 'remote'], scope => scope.slots.inject('conversation.approval.detail', () => {
        let original, disposeEntry, updating = false;
        const refresh = () => {
          if (updating) return;
          const entry = scope.slots.entries('conversation.approval.detail').find(item => item.options?.id !== 'auto-review-action-detail');
          if (entry === original && disposeEntry) return;
          updating = true;
          try {
          disposeEntry?.(); original = entry;
          function Detail(props) {
            const statuses = useSyncExternalStore(listener => scope.uiSession.sessionStatus.subscribe(listener), () => scope.uiSession.sessionStatus.getSnapshot());
            const list = useSyncExternalStore(listener => scope.sessions.list.subscribe(listener), () => scope.sessions.list.getSnapshot());
            const request = statuses.get(props.sessionId)?.pendingInteraction;
            const permission = list.byId[props.sessionId]?.projectionValues?.permissions?.currentValue
              ?? scope.sessions.binding(props.sessionId)?.session.projections?.faceOf('permissions')?.getSnapshot()?.currentValue;
            if (!isReviewPreset(permission) || request?.kind !== 'approval' || request.sessionId !== props.sessionId || request.callId !== props.callId || !request.answerable)
              return original?.component ? h(original.component, props) : null;
            return h(NativeApprovalDetail, { context: scope, request, sessionId: props.sessionId, callId: props.callId, t: scope.locale.bind(NS) });
          }
          disposeEntry = scope.slots.register({ name: 'conversation.approval.detail', id: 'auto-review-action-detail', priority: (entry?.options?.priority ?? 0) - 1, locale: NS }, Detail);
          } finally { updating = false; }
        };
        const unsubscribe = scope.slots.subscribe('conversation.approval.detail', refresh);
        refresh();
        return () => { unsubscribe(); disposeEntry?.(); };
      }));
    }
    function ChildApprovalItem({ entry, collector, sessions, t, resolveReason }) {
      const row = sessions.list.getSnapshot().byId[entry.sessionId];
      const request = entry.request, disabled = entry.answering || !request.answerable;
      const reason = request.displayReason ? resolveReason(request.displayReason) : request.reason;
      return h('li', { 'data-child-approval-key': entry.key, 'aria-busy': entry.answering },
        h('strong', null, row?.displayTitle ?? entry.sessionId), ' · ', h('code', null, request.toolName),
        h('p', { className: 'ar-help' }, h('code', null, entry.sessionId), request.callId ? ` · ${request.callId}` : ''),
        h('details', { open: true }, h('summary', null, t('childApprovalDetails')),
          reason ? h(React.Fragment, null, h('p', null, t('childApprovalReason')), h('pre', null, reason)) : null,
          entry.detail.status === 'ready' ? h(React.Fragment, null, h('p', null, t('childApprovalArguments')), h('pre', null, entry.detail.arguments)) : h('p', { className: 'ar-help', role: entry.detail.status === 'loading' ? 'status' : undefined }, t(!request.callId ? 'childApprovalNoCall' : entry.detail.status === 'loading' ? 'childApprovalLoading' : 'childApprovalMissing')),
          entry.detail.error ? h('p', { className: 'ar-error' }, entry.detail.error) : null),
        entry.error ? h('p', { className: 'ar-error', role: 'alert' }, `${t('childApprovalFailed')} ${entry.error}`) : null,
        h('div', { className: 'ar-actions' },
          h('button', { type: 'button', disabled, onClick: () => void collector.answer(entry, 'rejected') }, t('childApprovalReject')),
          h('button', { type: 'button', className: 'ar-primary', disabled: disabled || entry.detail.status !== 'ready', onClick: () => void collector.answer(entry, 'allowed-once') }, t('childApprovalAllow')),
          request.callId && ['missing', 'error'].includes(entry.detail.status) ? h('button', { type: 'button', disabled, onClick: () => void collector.reload(entry) }, t('childApprovalRetry')) : null));
    }
    function ChildApprovalSummary({ collector, sessions, sessionId, t, resolveReason }) {
      const entries = useSyncExternalStore(collector.subscribe, collector.getSnapshot);
      const list = useSyncExternalStore(listener => sessions.list.subscribe(listener), () => sessions.list.getSnapshot());
      // Root views only; unrelated roots never receive another tree's pending requests.
      if (list.byId[sessionId]?.origin === 'subagent') return null;
      const matching = entries.filter(entry => entry.rootId === sessionId);
      if (!matching.length) return null;
      return h('section', { className: 'ar-child-approvals', 'aria-label': t('childApprovals', { count: matching.length }) },
        h('h3', { 'aria-live': 'polite' }, t('childApprovals', { count: matching.length })),
        h('p', { className: 'ar-help' }, t('childApprovalsHelp')),
        h('ol', null, matching.map(entry => h(ChildApprovalItem, { key: entry.key, entry, collector, sessions, t, resolveReason }))));
    }
    function registerChildApprovals(ctx) {
      return ctx.inject(['sessions', 'uiSession', 'remote'], scope => scope.effect(() => {
        const collector = createApprovalCollector(scope.sessions, scope.uiSession.sessionStatus, (entry, signal) => readApprovalCall(scope, entry, signal));
        const disposeSlot = scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
          name: 'conversation.composer.dock', id: 'auto-review-child-approvals', order: -100, locale: NS,
          inject: () => ({ collector, sessions: scope.sessions, resolveReason: reason => scope.locale.resolveText(reason) }),
        }, ChildApprovalSummary));
        return () => { disposeSlot(); collector.dispose(); };
      }, 'auto-review-desktop: native child approval summary'));
    }

    // Display-only history; native renderers and permission decisions retain ownership.
    function createHistoryStore(connection, sessionId) {
      let snapshot = { records: [], loading: true, error: null, available: true };
      let controller, generation = 0;
      const listeners = new Set();
      const publish = next => { snapshot = next; for (const listener of listeners) listener(); };
      const start = () => {
        controller?.abort(); controller = new AbortController();
        const signal = controller.signal, current = ++generation;
        void (async () => {
          let revision;
          try {
            while (!signal.aborted && current === generation) {
              const response = await connection.rpc.call('/auto-review-desktop', revision === undefined ? 'history' : 'watch-history', { sessionId, ...(revision === undefined ? {} : { revision }) }, signal);
              if (signal.aborted || current !== generation) return;
              if (!response.ok || !Array.isArray(response.value?.records) || !Number.isSafeInteger(response.value.revision)) throw new Error('Review history unavailable');
              const changed = revision !== response.value.revision || snapshot.loading || snapshot.error || snapshot.available !== response.value.available;
              revision = response.value.revision;
              if (changed) publish({ records: response.value.records, available: response.value.available, loading: false, error: null });
              if (response.value.closed) return;
            }
          } catch {
            if (!signal.aborted && current === generation) publish({ ...snapshot, loading: false, error: true });
          }
        })();
      };
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); if (listeners.size === 1) start(); return () => { listeners.delete(listener); if (!listeners.size) { generation++; controller?.abort(); } }; },
        retry: start,
        dispose() { generation++; controller?.abort(); listeners.clear(); },
      };
    }
    function reviewPresentation(row) {
      const attempt = row.attempts?.at(-1), verdict = attempt?.verdict;
      const denial = row.attempts?.findLast(item => item.verdict?.decision === 'deny')?.verdict;
      const state = denial ? 'denied' : row.status === 'reviewing' ? 'reviewing' : row.status === 'failed' ? 'failed' : row.status === 'cancelled' || row.status === 'interrupted' ? 'interrupted' : verdict?.decision === 'allow' ? 'allowed' : 'failed';
      return { state, error: Boolean(denial) || state === 'failed', reason: denial?.reason, verdict };
    }
    function ReviewNotice({ row, t, inspectCall }) {
      const display = reviewPresentation(row);
      if (display.state === 'allowed') return h('div', { className: 'ar-review-notice ar-review-approved', role: 'status', 'data-review-call': row.callId, 'data-review-state': display.state, title: `${row.tool} · ${row.callId}\n${t('reviewAllowNote')}`, 'aria-label': `${t('reviewPassed')} · ${row.tool}. ${t('reviewAllowNote')}` },
        h('span', { className: 'ar-review-dot', 'aria-hidden': true }),
        h('span', { className: 'ar-review-title' }, t('reviewPassed')),
        inspectCall ? h('button', { type: 'button', className: 'ar-review-link', onClick: () => inspectCall(row.callId), 'aria-label': `${t('reviewInspect')} ${row.tool} ${row.callId}` }, t('reviewInspect')) : null);
      return h('div', { className: `ar-review-notice${display.error ? ' ar-review-error' : ''}`, role: display.error ? 'alert' : 'status', 'data-review-call': row.callId, 'data-review-state': display.state },
        h('span', { className: 'ar-review-dot', 'aria-hidden': true }),
        h('div', { className: 'ar-review-copy' },
          h('span', { className: 'ar-review-title' }, t(`review_${display.state}`), ' · ', row.tool),
          display.reason ? h('span', { className: 'ar-review-reason' }, display.reason) : display.state === 'denied' ? h('span', { className: 'ar-review-reason' }, t('reviewNoReason')) : null,
          row.gate === 'ask' ? h('span', { className: 'ar-review-reason' }, t('reviewHumanFallback')) : null),
        display.error ? h('code', { className: 'ar-review-code' }, display.state === 'denied' ? 'AUTO_REVIEW_DENIED' : row.code ?? 'AUTO_REVIEW_FAILED') : null,
        inspectCall ? h('button', { type: 'button', className: 'ar-review-link', onClick: () => inspectCall(row.callId), 'aria-label': `${t('reviewInspect')} ${row.tool} ${row.callId}` }, t('reviewInspect')) : null);
    }
    function ReviewHistoryStatus({ snapshot, store, t }) {
      return h(React.Fragment, null,
        snapshot.error ? h('p', { className: 'ar-review-warning', role: 'status' }, t('reviewLoadFailed'), ' ', h('button', { type: 'button', className: 'ar-review-link', onClick: store.retry }, t('reviewReload'))) : null,
        snapshot.available === false ? h('p', { className: 'ar-review-warning' }, t('reviewMemoryOnly')) : null);
    }
    function ToolReviewRows({ snapshot, root, t, inspectCall }) {
      if (!root) return null;
      const rows = snapshot.records.filter(row => row.rootCallId === root.callId);
      return rows.map(row => h(ReviewNotice, { key: row.id, row, t, inspectCall }));
    }
    function ReviewTrajectory({ snapshot, store, t, inspectCall }) {
      const [query, setQuery] = useState('');
      const rows = snapshot.records.filter(row => `${row.tool} ${row.callId} ${row.rootCallId}`.toLowerCase().includes(query.toLowerCase()));
      return h('details', { className: 'ar-review-trajectory ar-review-standalone', open: true },
        h('summary', null, t('reviewHistory'), ` (${snapshot.records.length})`),
        h('div', { className: 'ar-review-ledger' },
          h('p', null, t('reviewHistoryHelp')),
          h(ReviewHistoryStatus, { snapshot, store, t }),
          snapshot.loading ? h('p', { role: 'status' }, t('reviewHistoryLoading')) : null,
          snapshot.records.length ? h('input', { type: 'search', value: query, placeholder: t('reviewFilter'), 'aria-label': t('reviewFilter'), onChange: event => setQuery(event.target.value) }) : h('p', null, t('reviewHistoryEmpty')),
          rows.map(row => h('details', { key: row.id, className: 'ar-review-record', 'data-review-record': row.id },
            h('summary', null, t(`review_${reviewPresentation(row).state}`), ' · ', row.tool, ' · ', row.callId),
            h('p', null, t('reviewOriginalCall'), ': ', h('code', null, row.rootCallId)),
            h('p', null, t('reviewGate'), ': ', row.gate ? t(`reviewGate_${row.gate}`) : t('reviewGatePending')),
            inspectCall ? h('button', { type: 'button', className: 'ar-review-link', onClick: () => inspectCall(row.callId) }, t('reviewInspect')) : null,
            h('pre', null, JSON.stringify(row, null, 2))))));
    }
    // Project existing root tool-call events into independent Chat rows. The
    // session log stays unchanged; the view only joins its call ID to history.
    const reviewCallDefinition = {
      kind: 'auto-review-call-status', target: 'chat',
      match: { 'tool/call': event => ({ id: String(event.data.callId), role: 'start' }) },
      start: (_context, match) => ({ seq: match.event.seq, root: { callId: String(match.event.data.callId) } }),
      update: context => context.state,
      buildViewNode: context => context.state === undefined ? null : {
        key: context.key, kind: 'auto-review-call-status', id: context.id, target: 'chat',
        anchorSeq: context.state.seq + 0.01,
        location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
        visibility: 'visible', data: context.state,
      },
    };
    function registerReviewHistory(ctx) {
      return ctx.inject(['connection', 'uiConversation'], scope => scope.effect(() => {
        const stores = new Map();
        const storeFor = sessionId => { if (!stores.has(sessionId)) stores.set(sessionId, createHistoryStore(scope.connection, sessionId)); return stores.get(sessionId); };
        function ChatReview(props) {
          const store = storeFor(props.sessionId), snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
          return h(ToolReviewRows, { snapshot, root: props.node.data.root, t: scope.locale.bind(NS), inspectCall: props.inspectCall });
        }
        function TrajectoryReview(props) {
          const store = storeFor(props.sessionId), snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
          return h(ReviewTrajectory, { snapshot, store, t: scope.locale.bind(NS), inspectCall: props.inspectCall });
        }
        function HistoryConnectionStatus(props) {
          const store = storeFor(props.sessionId), snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
          if (!snapshot.error && snapshot.available !== false) return null;
          return h('div', { className: 'ar-review-connection' }, h(ReviewHistoryStatus, { snapshot, store, t: scope.locale.bind(NS) }));
        }
        const definition = scope.uiConversation.events.register(reviewCallDefinition);
        const dock = scope.slots.inject('conversation.composer.dock', () => scope.slots.register({ name: 'conversation.composer.dock', id: 'auto-review-history-status', order: -90, locale: NS }, HistoryConnectionStatus));
        const chat = scope.slots.inject('conversation.chat.node', () => scope.slots.register({ name: 'conversation.chat.node', key: 'auto-review-call-status', locale: NS }, ChatReview));
        const trajectory = scope.slots.inject('conversation.view', () => scope.slots.register({ name: 'conversation.view', id: 'auto-review-trajectory', order: 11, locale: NS, label: () => scope.locale.bind(NS)('reviewTab') }, TrajectoryReview));
        return () => { definition(); dock(); chat(); trajectory(); for (const store of stores.values()) store.dispose(); stores.clear(); };
      }, 'auto-review-desktop: review history'));
    }


    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'auto-review-desktop: settings copy');
      ctx.effect(() => installStyles(), 'auto-review-desktop: settings styles');
      ctx.effect(() => registerPermissionPresentation(ctx), 'auto-review-desktop: permission presentation');
      if (typeof ctx.inject === 'function') {
        ctx.effect(() => registerChildApprovals(ctx), 'auto-review-desktop: child approval presentation');
        ctx.effect(() => registerApprovalDetails(ctx), 'auto-review-desktop: complete native approval details');
        ctx.effect(() => registerReviewHistory(ctx), 'auto-review-desktop: persisted review presentation');
      }
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.configForms.whileServed(['auto-review-desktop'], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'auto-review-desktop', order: 12, label: () => t('nav'), locale: NS,
        inject: () => ({ form: ctx.configForms.get('auto-review-desktop'), mirror: ctx.configForms.describe(), catalog: ctx.modelDirectories.catalog, connection: ctx.connection }),
      }, SettingsSection))), 'auto-review-desktop: native settings section');
    }
    return {
      name: 'dsh-auto-review-desktop',
      inject: ['slots', 'locale', 'configForms', 'modelDirectories', 'connection', 'uiConversation'],
      apply,
      // Pure helpers and the components are exported for offline contract tests.
      SettingsSection, UsageCard, draftOf, sameDraft, modelChoices, validateDraft,
      localizePermissionCatalog, decoratePermissionTree, registerPermissionPresentation, permissionDictionaries: { en, zh },
      createApprovalCollector, approvalRoot, readApprovalCall, ChildApprovalSummary, ChildApprovalItem, registerChildApprovals,
      loadApprovalDetail, ApprovalDetailBody, NativeApprovalDetail, registerApprovalDetails,
      createHistoryStore, reviewPresentation, ReviewNotice, ToolReviewRows, ReviewTrajectory, reviewCallDefinition, registerReviewHistory,
    };
  },
});
