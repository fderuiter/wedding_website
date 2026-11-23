import type { InvitationCodeDTO } from '@/features/registry';

interface DemoRuntimeBridgeHandlers {
  isAdminSession: () => boolean;
  findGuestByCode: (rawCode: string) => InvitationCodeDTO | null;
}

let runtimeActive = false;
let bridgeHandlers: DemoRuntimeBridgeHandlers | null = null;

export function registerDemoRuntimeBridge(
  handlers: DemoRuntimeBridgeHandlers | null
): void {
  bridgeHandlers = handlers;
}

export function setDemoBridgeRuntimeActive(active: boolean): void {
  runtimeActive = active;
}

export function isDemoRuntimeActive(): boolean {
  return runtimeActive;
}

export function isDemoAdminSession(): boolean {
  if (!runtimeActive || !bridgeHandlers) {
    return false;
  }
  return bridgeHandlers.isAdminSession();
}

export function findDemoGuestByCode(rawCode: string): InvitationCodeDTO | null {
  if (!bridgeHandlers) {
    return null;
  }
  return bridgeHandlers.findGuestByCode(rawCode);
}
