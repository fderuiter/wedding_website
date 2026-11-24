let demoRuntimeActive = false;

export function setDemoRuntimeFlag(active: boolean): void {
  demoRuntimeActive = active;
}

export function isDemoRuntimeFlagActive(): boolean {
  return demoRuntimeActive;
}
