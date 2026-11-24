import type { InvitationCodeDTO } from '@/features/registry';
import { isDemoRuntimeFlagActive, setDemoRuntimeFlag } from './runtimeFlag';

interface DemoRuntimeBridgeHandlers {
  isAdminSession: () => boolean;
  findGuestByCode: (rawCode: string) => InvitationCodeDTO | null;
}

let bridgeHandlers: DemoRuntimeBridgeHandlers | null = null;

export function registerDemoRuntimeBridge(
  handlers: DemoRuntimeBridgeHandlers | null
): void {
  bridgeHandlers = handlers;
}

export function setDemoBridgeRuntimeActive(active: boolean): void {
  setDemoRuntimeFlag(active);
}

export function isDemoRuntimeActive(): boolean {
  return isDemoRuntimeFlagActive();
}

export function isDemoAdminSession(): boolean {
  if (!isDemoRuntimeFlagActive() || !bridgeHandlers) {
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
