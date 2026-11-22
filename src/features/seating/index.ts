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
export type { AutoAssignOptions } from './admin.service';
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
export { generateAveryCardsPdf, generateSeatingChartPdf } from './pdf.service';
export {
  computeSeatPosition,
  resolveDetailedSeatAssignments,
  resolveSeatAssignments,
} from './seatLayout';
export {
  ADDRESS_COLLECTION_TAG,
  computeTableMealCounts,
  getDietaryBadges,
  getGuestAttendanceStatus,
  getGuestPlusOneNamesList,
  getRequiredChairCount,
  getSeatingShapeLabel,
  getTableOccupiedChairCount,
  hasAddressCollectionTag,
  isGuestEligibleForSeating,
  isLandmarkTable,
  isOneSidedTableShape,
} from './utils/seatingHelpers';
export type { DietaryBadgeInfo } from './utils/seatingHelpers';
