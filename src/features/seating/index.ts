export {
  AssignSeatSchema,
  AutoAssignResultSchema,
  AutoAssignSchema,
  SeatingTableSchema,
  SeatingTableInputSchema,
  SeatingTableUpdateInputSchema,
} from './schemas';
export type {
  AutoAssignResultDTO,
  AutoAssignDTO,
  SeatingTableDTO,
} from './schemas';
export { SeatingTableAdminService } from './admin.service';
export { PrintableFloorplan } from './components/PrintableFloorplan';
export { FloorplanCanvas } from './components/FloorplanCanvas';
export { UnassignedGuestPanel } from './components/UnassignedGuestPanel';
export { TableModal } from './components/TableModal';
export {
  initialSeatingState,
  seatingReducer,
  syncTablesWithGuests,
  useSeatingChartState,
  useSeatingState,
} from './hooks/useSeatingState';
export type {
  SeatingState,
  SeatingAction,
  SeatingUndoSnapshot,
  GuestSeatSnapshot,
  UseSeatingStateOptions,
} from './hooks/useSeatingState';
export { generateSeatingChartPdf } from './pdf.service';
export {
  computeSeatPosition,
  resolveDetailedSeatAssignments,
  resolveSeatAssignments,
} from './seatLayout';
export {
  ADDRESS_COLLECTION_TAG,
  isGuestEligibleForSeating,
  getDietaryBadges,
  getGuestAttendanceStatus,
  getGuestCompanionNames,
  getGuestPartySize,
  getGuestsHeadcount,
  hasAddressCollectionTag,
  isOneSidedTableShape,
} from './utils/seatingHelpers';
export type { DietaryBadgeInfo } from './utils/seatingHelpers';
