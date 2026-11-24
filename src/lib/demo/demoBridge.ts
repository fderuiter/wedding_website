import type { InvitationCodeDTO, RegistryShippingAddress } from '@/features/registry';

export interface DemoRuntimeBridge {
  isActive: () => boolean;
  isAdminSession: () => boolean;
  findGuestByCode: (rawCode: string) => InvitationCodeDTO | null;
  getShippingAddress?: () => RegistryShippingAddress;
}

export const DEMO_DEFAULT_SHIPPING_ADDRESS: RegistryShippingAddress = {
  recipientName: 'Alex & Taylor',
  addressLine1: '742 Evergreen Terrace',
  addressLine2: 'Apt 4B',
  city: 'Chicago',
  state: 'IL',
  zip: '60611',
  country: 'USA',
  phone: '(312) 555-0192',
  deliveryNotes: 'Front desk concierge accepts packages daily 8am–8pm.',
};

let activeBridge: DemoRuntimeBridge | null = null;

export function registerDemoRuntimeBridge(bridge: DemoRuntimeBridge | null): void {
  activeBridge = bridge;
}

export function isDemoBridgeActive(): boolean {
  return activeBridge ? activeBridge.isActive() : false;
}

export function isDemoBridgeAdminSession(): boolean {
  return activeBridge ? activeBridge.isAdminSession() : false;
}

export function findDemoBridgeGuestByCode(rawCode: string): InvitationCodeDTO | null {
  return activeBridge ? activeBridge.findGuestByCode(rawCode) : null;
}

export function getDemoBridgeShippingAddress(): RegistryShippingAddress {
  return activeBridge?.getShippingAddress?.() ?? DEMO_DEFAULT_SHIPPING_ADDRESS;
}
