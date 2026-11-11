/* Native DSH Desktop client bundle. React is supplied by the existing module loader. */
window.__ModuleLoader__.load({
  id: 'dsh-auto-review-desktop',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useEffect, useRef, useSyncExternalStore, cloneElement, isValidElement, Children } = React;
    const { Menu, PermissionIconAutoReviewRegular } = require('@deepseek-ai/dsh-client-ui-primitives');
    const NS = 'autoReviewDesktop';
    const FIELDS = ['routeMode', 'provider', 'model', 'reasoningMode', 'reasoningEffort', 'timeoutMs', 'maxOutputTokens', 'maxInputChars', 'maxReviewsPerTurn', 'maxRetries', 'failurePolicy', 'preciseDeletion', 'workspaceEscalation'];
    const DEFAULTS = { routeMode: 'follow', provider: '', model: '', reasoningMode: 'low', reasoningEffort: '', timeoutMs: 60000, maxOutputTokens: 2048, maxInputChars: 120000, maxReviewsPerTurn: 100, maxRetries: 0, failurePolicy: 'deny', preciseDeletion: true, workspaceEscalation: 'ask' };
    const LIMITS = { timeoutMs: [1000, 180000], maxOutputTokens: [256, 16384], maxInputChars: [4000, 1000000], maxReviewsPerTurn: [1, 1000], maxRetries: [0, 1] };
    const en = {
      permissionFullLabel: 'Auto review (Full access)', permissionWorkspaceLabel: 'Auto review (Workspace)',
      permissionFullBadge: 'ENHANCED', permissionWorkspaceBadge: 'ENHANCED',
      permissionFullDescription: 'Review each action with your configured model while running without a sandbox. Uses additional tokens.',
      permissionWorkspaceDescription: 'Sandbox-confined operations skip review; outside-workspace requests use configured approval.',
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
      save: 'Save settings', saving: 'Saving…', saved: 'Saved. Future reviews use these profile settings.', unsaved: 'Unsaved changes', clean: 'Saved configuration',
      saveFailed: 'Save failed. Host settings were reloaded; your draft is kept. Reload the saved settings before retrying if another editor changed them.',
      reload: 'Reload saved settings', reloadAll: 'Reload settings', reloading: 'Reloading…', reloadFailed: 'Could not reload settings.',
      conflict: 'Settings changed elsewhere. Reload saved settings to avoid overwriting that change.',
      invalidNumber: 'Enter a whole number from {min} to {max}.', invalidBoolean: 'Choose an enabled or disabled state.', modelRequired: 'Choose an available configured model.',
      preciseDeletion: 'Precise deletion protection',
      preciseDeletionHelp: 'Enabled by default for Full access actions and Workspace actions sent for model review. Workspace operations that skip review do not receive deletion review. Review must verify resolved targets and scope; insufficient evidence must not be automatically approved. This is a model policy, not an operating-system deletion block.',
      workspaceEscalation: 'Outside-workspace actions', workspaceAsk: 'Human approval (default)', workspaceReview: 'Model review',
      workspaceEscalationHelp: 'Only controls outside-workspace actions and permission escalation in Workspace mode. Full access still reviews every action. Approval applies once and does not change the session mode. The sandbox does not provide operating-system isolation for network access or reads.',
      invalidWorkspaceEscalation: 'Choose human approval or model review.',
      pendingLoad: 'Wait for settings to finish loading.',
      usageTitle: 'Review usage', usageScope: 'This Host run only · Counts reset when the Host restarts. Loaded once when this page opens; refresh manually for the latest counts.',
      usageLoading: 'Loading review usage…', usageRefresh: 'Refresh usage', usageFailure: 'Could not load review usage.', usageInvalid: 'The Host returned an unsupported usage response.',
      usageUnknown: 'Unknown', usageAttempts: 'Review attempts', usageAllows: 'Reviewer allows', usageDenies: 'Reviewer denies', usageFailures: 'Failed', usageCancelled: 'Cancelled',
      usageInput: 'Input tokens', usageOutput: 'Output tokens', usageCache: 'Cache-read tokens', usageReported: 'Attempts reporting usage',
      usageNote: 'Each token total sums only attempts that reported that field and may be partial. Unreported fields are unknown. Reasoning may already be included in output tokens and must not be added again. Reviewer allows/denies describe model verdicts; tools must still pass other permission checks.',
      usageAuditUnavailable: 'Audit storage is unavailable. These in-memory counts still cover this Host run.', usageStopped: 'The review service is not running.',
    };
    const zh = {
      permissionFullLabel: '自动审查（完全访问）', permissionWorkspaceLabel: '自动审查（工作区）',
      permissionFullBadge: '增强', permissionWorkspaceBadge: '增强',
      permissionFullDescription: '无沙箱运行，按配置的模型逐次审查，会消耗额外 token。',
      permissionWorkspaceDescription: '沙箱约束内的操作免审；工作区外请求按配置交由人工审批或模型审查。',
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
      save: '保存设置', saving: '正在保存…', saved: '已保存。后续审查将使用这些配置。', unsaved: '有未保存修改', clean: '已保存的配置',
      saveFailed: '保存失败。已重新读取服务端设置，当前草稿仍保留；若其他编辑器修改了设置，请先重新载入已保存设置。',
      reload: '重新载入已保存设置', reloadAll: '重新读取设置', reloading: '正在重新读取…', reloadFailed: '重新读取设置失败。',
      conflict: '设置已在其他位置修改。请重新载入已保存设置，避免覆盖该修改。',
      invalidNumber: '请输入 {min} 至 {max} 之间的整数。', invalidBoolean: '请选择开启或关闭状态。', modelRequired: '请选择当前可用的已配置模型。',
      preciseDeletion: '精确删除保护',
      preciseDeletionHelp: '默认开启，用于完全访问模式及工作区模式中送交模型审查的动作。工作区免审操作不经过删除审查。审查须核实解析后的目标与范围，证据不足时不得自动批准。这是模型策略，而非操作系统删除拦截。',
      workspaceEscalation: '工作区外操作', workspaceAsk: '人工审批（默认）', workspaceReview: '模型审查',
      workspaceEscalationHelp: '仅配置工作区模式的外部动作及提权处理；完全访问模式仍逐次送审。批准只针对本次操作，不改变会话模式。沙箱对网络访问和读取并非操作系统级隔离。',
      invalidWorkspaceEscalation: '请选择人工审批或模型审查。',
      pendingLoad: '请等待设置读取完成。',
      usageTitle: '审查用量', usageScope: '仅统计本次服务运行，服务重启后归零。打开页面时读取一次；可手动刷新查看最新计数。',
      usageLoading: '正在读取审查用量…', usageRefresh: '刷新用量', usageFailure: '审查用量读取失败。', usageInvalid: '服务端返回了不支持的用量格式。',
      usageUnknown: '未知', usageAttempts: '审查尝试', usageAllows: '模型允许', usageDenies: '模型拒绝', usageFailures: '失败', usageCancelled: '取消',
      usageInput: '输入 token', usageOutput: '输出 token', usageCache: '缓存读取 token', usageReported: '已报告用量的尝试',
      usageNote: '各项 token 仅汇总报告了该字段的尝试，可能只覆盖部分审查；未报告的字段未知。推理 token 可能已计入输出 token，不能重复相加。模型允许／拒绝仅表示审查模型的判定，实际工具仍须通过其他权限检查。',
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
      if (!['ask', 'review'].includes(draft.workspaceEscalation)) errors.workspaceEscalation = 'invalidWorkspaceEscalation';
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

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'auto-review-desktop: settings copy');
      ctx.effect(() => installStyles(), 'auto-review-desktop: settings styles');
      ctx.effect(() => registerPermissionPresentation(ctx), 'auto-review-desktop: permission presentation');
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.configForms.whileServed(['auto-review-desktop'], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'auto-review-desktop', order: 12, label: () => t('nav'), locale: NS,
        inject: () => ({ form: ctx.configForms.get('auto-review-desktop'), mirror: ctx.configForms.describe(), catalog: ctx.modelDirectories.catalog, connection: ctx.connection }),
      }, SettingsSection))), 'auto-review-desktop: native settings section');
    }
    return {
      name: 'dsh-auto-review-desktop',
      inject: ['slots', 'locale', 'configForms', 'modelDirectories', 'connection'],
      apply,
      // Pure helpers and the components are exported for offline contract tests.
      SettingsSection, UsageCard, draftOf, sameDraft, modelChoices, validateDraft,
      localizePermissionCatalog, decoratePermissionTree, registerPermissionPresentation, permissionDictionaries: { en, zh },
    };
  },
});
