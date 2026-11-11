// The host reserves registerAuto() for the official integration. Contribute only
// our own configured preset; never replace its methods or its Auto registration.
export const DESKTOP_PRESET='auto-review-desktop';
export const DESKTOP_PRESET_SPEC=Object.freeze({
  sandbox:'danger-full-access',approval:'ask',
  name:'Auto review (Desktop)',
  description:'Review each action with the configured model and limits. Runs without a sandbox and uses additional tokens.',
});

// Read durable identity, rather than derive()'s knob-only fallback. In particular,
// delegated children retain this identity with approval=never, and must still be
// reviewed even though the host derives the Full access preset for those knobs.
export function isDesktopReview(session) {
  const events=session.snapshotEvents();
  return events.findLast(event=>event.type==='permission/preset')?.data.preset===DESKTOP_PRESET
    && events.findLast(event=>event.type==='sandbox/mode')?.data.mode==='danger-full-access';
}

export function registerDesktopPreset(service) {
  if(!service.presets || !Object.isExtensible(service.presets) || typeof service.emitCatalogChanged!=='function') {
    throw new Error('auto-review-desktop: unsupported permission preset service');
  }
  if(Object.hasOwn(service.presets,DESKTOP_PRESET))throw new Error('auto-review-desktop: preset already registered');
  service.presets[DESKTOP_PRESET]=DESKTOP_PRESET_SPEC;
  service.emitCatalogChanged();
  return ()=>{
    if(service.presets[DESKTOP_PRESET]!==DESKTOP_PRESET_SPEC)return;
    delete service.presets[DESKTOP_PRESET];
    service.emitCatalogChanged();
  };
}
