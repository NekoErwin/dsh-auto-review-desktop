// Keep the legacy full-access key so existing sessions retain their semantics.
export const DESKTOP_PRESET='auto-review-desktop';
export const WORKSPACE_PRESET='auto-review-workspace';
export const DESKTOP_PRESET_SPEC=Object.freeze({
  sandbox:'danger-full-access',approval:'ask',
  name:'Auto review (Full access)',
  description:'Review every action without a sandbox, using the configured model and limits.',
});
export const WORKSPACE_PRESET_SPEC=Object.freeze({
  sandbox:'workspace-write',approval:'ask',
  name:'Auto review (Workspace)',
  description:'Skip review for supported sandbox-confined work. Outside requests use human approval or model review.',
});

// Durable identity also survives delegated children whose approval policy is never.
export function desktopMode(session) {
  const events=session.snapshotEvents();
  const preset=events.findLast(event=>event.type==='permission/preset')?.data.preset;
  const sandbox=events.findLast(event=>event.type==='sandbox/mode')?.data.mode;
  if(preset===DESKTOP_PRESET && sandbox==='danger-full-access')return 'full';
  if(preset===WORKSPACE_PRESET && sandbox==='workspace-write')return 'workspace';
  return undefined;
}
export function isDesktopReview(session) {return desktopMode(session)!==undefined;}

export function registerDesktopPreset(service) {
  if(!service.presets || !Object.isExtensible(service.presets) || typeof service.emitCatalogChanged!=='function') {
    throw new Error('auto-review-desktop: unsupported permission preset service');
  }
  const entries=[[DESKTOP_PRESET,DESKTOP_PRESET_SPEC],[WORKSPACE_PRESET,WORKSPACE_PRESET_SPEC]];
  for(const [key] of entries)if(Object.hasOwn(service.presets,key))throw new Error('auto-review-desktop: preset already registered');
  for(const [key,spec] of entries)service.presets[key]=spec;
  service.emitCatalogChanged();
  return ()=>{
    for(const [key,spec] of entries)if(service.presets[key]===spec)delete service.presets[key];
    service.emitCatalogChanged();
  };
}
