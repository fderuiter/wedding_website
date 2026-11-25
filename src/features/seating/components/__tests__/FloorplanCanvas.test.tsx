import { Profiler } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { FloorplanCanvas } from '../FloorplanCanvas';
import { computeSeatPosition, resolveDetailedSeatAssignments } from '../../seatLayout';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO, matchDietaryCategory } from '@/features/registry';

jest.mock('../../seatLayout', () => {
  const actual = jest.requireActual('../../seatLayout');
  return {
    ...actual,
    resolveDetailedSeatAssignments: jest.fn(actual.resolveDetailedSeatAssignments),
    computeSeatPosition: jest.fn(actual.computeSeatPosition),
    computeScaledTableDimensions: jest.fn(actual.computeScaledTableDimensions),
  };
});

jest.mock('@/features/registry/utils/invitation', () => {
  const actual = jest.requireActual('@/features/registry/utils/invitation');
  return {
    ...actual,
    matchDietaryCategory: jest.fn(actual.matchDietaryCategory),
  };
});

expect.extend(toHaveNoViolations);

if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class JSDOMPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? '';
    }
  }
  window.PointerEvent = JSDOMPointerEvent as unknown as typeof PointerEvent;
}

describe('FloorplanCanvas component', () => {
  const mockTables: SeatingTableDTO[] = [
    {
      id: 'table-1',
      name: 'Head Table',
      shape: 'rectangular',
      capacity: 2,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
      invitationCodes: [
        {
          id: 'guest-1',
          code: 'CODE1',
          guestName: 'John Doe',
          tableId: 'table-1',
          seatNumber: 1,
        } as InvitationCodeDTO,
      ],
    },
    {
      id: 'table-2',
      name: 'Overcapacity Table',
      shape: 'round',
      capacity: 1,
      x: 300,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
      invitationCodes: [
        {
          id: 'guest-2',
          code: 'CODE2',
          guestName: 'Alice Smith',
          tableId: 'table-2',
          seatNumber: 1,
        } as InvitationCodeDTO,
        {
          id: 'guest-3',
          code: 'CODE3',
          guestName: 'Bob Jones',
          tableId: 'table-2',
          seatNumber: 2,
        } as InvitationCodeDTO,
      ],
    },
  ];

  const defaultProps = {
    tables: mockTables,
    selectedTableId: null,
    onSelectTable: jest.fn(),
    onUpdateTablePosition: jest.fn(),
    onUpdateTableRotation: jest.fn(),
    onDropGuestOnTable: jest.fn(),
    onUnassignGuest: jest.fn(),
    onOpenSeatAssignModal: jest.fn(),
    onAddTable: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders canvas container with theme preset background, border, and grid dot variables', () => {
    const { container } = render(<FloorplanCanvas {...defaultProps} />);
    const canvasElement = container.firstElementChild as HTMLElement;

    expect(canvasElement).toBeInTheDocument();
    expect(canvasElement.style.backgroundColor).toBe('var(--canvas-bg, #f8fafc)');
    expect(canvasElement.style.border).toBe('var(--canvas-border, 2px dashed #cbd5e1)');
    expect(canvasElement.style.backgroundImage).toBe('radial-gradient(circle, var(--canvas-grid-dot, #cbd5e1) 1px, transparent 1px)');
  });

  it('binds table surface container styles to floorplan table tokens', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const headTableElement = screen.getByText('Head Table').closest('div') as HTMLElement;
    expect(headTableElement.style.backgroundColor).toBe('var(--floorplan-table-bg, #ffffff)');
    expect(headTableElement.style.borderColor).toBe('var(--floorplan-table-border, #d1d5db)');
    expect(headTableElement.style.borderRadius).toBe('var(--floorplan-table-radius, 0.75rem)');
  });

  it('binds overcapacity table surface styles to status alert tokens', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const overcapacityTableElement = screen.getByText('Overcapacity Table').closest('div') as HTMLElement;
    expect(overcapacityTableElement.style.backgroundColor).toBe('var(--floorplan-status-overcapacity-bg, #fef2f2)');
    expect(overcapacityTableElement.style.borderColor).toBe('var(--floorplan-status-overcapacity-border, #ef4444)');
    expect(screen.getByText('Over capacity!')).toBeInTheDocument();
  });

  it('renders capacity warning badge on full tables', () => {
    const fullTable: SeatingTableDTO = {
      id: 'table-full',
      name: 'Full Table',
      shape: 'round',
      capacity: 2,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
      invitationCodes: [
        { id: 'guest-a', guestName: 'Guest A', tableId: 'table-full', seatNumber: 1 } as InvitationCodeDTO,
        { id: 'guest-b', guestName: 'Guest B', tableId: 'table-full', seatNumber: 2 } as InvitationCodeDTO,
      ],
    };

    render(<FloorplanCanvas {...defaultProps} tables={[fullTable]} />);

    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.getByTestId('table-full-badge')).toBeInTheDocument();
  });

  it('sets dropEffect to none and applies disabled drop indicator styling when dragging over a full table', () => {
    const fullTable: SeatingTableDTO = {
      id: 'table-full',
      name: 'Full Table',
      shape: 'round',
      capacity: 2,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
      invitationCodes: [
        { id: 'guest-a', guestName: 'Guest A', tableId: 'table-full', seatNumber: 1 } as InvitationCodeDTO,
        { id: 'guest-b', guestName: 'Guest B', tableId: 'table-full', seatNumber: 2 } as InvitationCodeDTO,
      ],
    };

    render(<FloorplanCanvas {...defaultProps} tables={[fullTable]} />);

    const tableOuterDiv = screen.getByRole('button', { name: /Full Table/i });
    const dataTransfer = { types: ['text/plain'], dropEffect: 'move' };

    fireEvent.dragOver(tableOuterDiv, { dataTransfer });

    expect(dataTransfer.dropEffect).toBe('none');
    expect(tableOuterDiv.className).toContain('ring-red-500');
    expect(tableOuterDiv.className).toContain('border-red-500');
    expect(tableOuterDiv.className).toContain('cursor-not-allowed');
    expect(tableOuterDiv.className).not.toContain('ring-4 ring-primary');
    expect(tableOuterDiv).toHaveAttribute('data-drop-disabled', 'true');
    expect(tableOuterDiv).toHaveAttribute('aria-disabled', 'true');
  });

  it('announces table capacity limits to screen readers and rejects drop when invalid drop targets a full table', () => {
    const onDropGuestOnTable = jest.fn();
    const fullTable: SeatingTableDTO = {
      id: 'table-full',
      name: 'Full Table',
      shape: 'round',
      capacity: 2,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
      invitationCodes: [
        { id: 'guest-a', guestName: 'Guest A', tableId: 'table-full', seatNumber: 1 } as InvitationCodeDTO,
        { id: 'guest-b', guestName: 'Guest B', tableId: 'table-full', seatNumber: 2 } as InvitationCodeDTO,
      ],
    };

    render(
      <FloorplanCanvas
        {...defaultProps}
        tables={[fullTable]}
        onDropGuestOnTable={onDropGuestOnTable}
      />
    );

    const tableOuterDiv = screen.getByRole('button', { name: /Full Table/i });
    fireEvent.drop(tableOuterDiv, {
      dataTransfer: {
        getData: (format: string) => (format === 'text/plain' ? 'guest-c' : ''),
      },
    });

    expect(onDropGuestOnTable).not.toHaveBeenCalled();
    expect(
      screen.getByText('Table "Full Table" has reached its maximum capacity of 2.')
    ).toBeInTheDocument();
  });

  it('allows moving an existing guest between seats at the same full table without rejection', () => {
    const onDropGuestOnTable = jest.fn();
    const fullTable: SeatingTableDTO = {
      id: 'table-full',
      name: 'Full Table',
      shape: 'round',
      capacity: 2,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
      invitationCodes: [
        { id: 'guest-a', guestName: 'Guest A', tableId: 'table-full', seatNumber: 1 } as InvitationCodeDTO,
        { id: 'guest-b', guestName: 'Guest B', tableId: 'table-full', seatNumber: 2 } as InvitationCodeDTO,
      ],
    };

    render(
      <FloorplanCanvas
        {...defaultProps}
        tables={[fullTable]}
        onDropGuestOnTable={onDropGuestOnTable}
      />
    );

    const tableOuterDiv = screen.getByRole('button', { name: /Full Table/i });
    fireEvent.drop(tableOuterDiv, {
      dataTransfer: {
        getData: (format: string) => (format === 'text/plain' ? 'guest-a' : ''),
      },
    });

    expect(onDropGuestOnTable).toHaveBeenCalledWith('guest-a', 'table-full', undefined);
  });

  it('binds assigned and unassigned seats to theme preset variables', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    // Assigned seat circle for Seat 1 on Head Table
    const assignedSeat = screen.getByTitle(/Seat 1: John Doe/).closest('button, div') as HTMLElement;
    expect(assignedSeat.style.backgroundColor).toBe('var(--floorplan-seat-assigned-bg, var(--color-primary, #B91C1C))');
    expect(assignedSeat.style.color).toBe('var(--floorplan-seat-assigned-text, #ffffff)');

    // Unassigned seat circle for Seat 2 on Head Table
    const unassignedSeat = screen.getByTitle(/Seat 2: Empty/).closest('button, div') as HTMLElement;
    expect(unassignedSeat.style.backgroundColor).toBe('var(--floorplan-table-bg, #ffffff)');
    expect(unassignedSeat.className).toContain('hover:bg-[var(--floorplan-seat-unassigned-hover,#fef2f2)]');
  });

  it('applies ring-4 ring-primary and border-primary visual feedback when hovering dragged guest over a table', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const tableOuterDiv = screen.getByRole('button', { name: /Head Table, shape/i });
    fireEvent.dragEnter(tableOuterDiv, {
      dataTransfer: { types: ['text/plain'] },
    });

    expect(tableOuterDiv.className).toContain('ring-4 ring-primary');
    expect(tableOuterDiv.className).toContain('border-primary');
  });

  it('applies scale-125 bg-primary/20 border-primary feedback when hovering dragged guest over an individual seat', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const unassignedSeat = screen.getByTitle(/Seat 2: Empty/).closest('button, div') as HTMLElement;
    fireEvent.dragEnter(unassignedSeat, {
      dataTransfer: { types: ['text/plain'] },
    });

    expect(unassignedSeat.className).toContain('scale-125');
    expect(unassignedSeat.className).toContain('bg-primary/20');
    expect(unassignedSeat.className).toContain('border-primary');
  });

  it('resets active drop target state when leaving or ending drag gesture', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const tableOuterDiv = screen.getByRole('button', { name: /Head Table, shape/i });
    fireEvent.dragEnter(tableOuterDiv, {
      dataTransfer: { types: ['text/plain'] },
    });
    expect(tableOuterDiv.className).toContain('ring-4 ring-primary');

    fireEvent.dragLeave(tableOuterDiv, {
      relatedTarget: document.body,
    });
    expect(tableOuterDiv.className).not.toContain('border-primary shadow-xl shadow-primary/20');
  });

  it('displays zero-state UI containing empty floorplan icon, setup copy, and Add First Table button when tables is empty', () => {
    render(<FloorplanCanvas {...defaultProps} tables={[]} />);

    expect(screen.getByTestId('empty-floorplan-icon')).toBeInTheDocument();
    expect(screen.getByText('No Tables Created Yet')).toBeInTheDocument();
    expect(screen.getByText(/Get started by adding your first reception table/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add First Table/i })).toBeInTheDocument();

    const emptyCard = screen.getByText('No Tables Created Yet').closest('div.rounded-2xl') as HTMLElement;
    expect(emptyCard).toBeInTheDocument();
    expect(emptyCard.className).toContain('bg-card/80');
    expect(emptyCard.className).toContain('border-card-border');
    expect(emptyCard.className).not.toContain('border-gray-200');
    expect(emptyCard.className).not.toContain('dark:border-gray-700');
  });

  it('invokes onAddTable callback when clicking Add First Table button in zero state view', () => {
    const onAddTableMock = jest.fn();
    render(<FloorplanCanvas {...defaultProps} tables={[]} onAddTable={onAddTableMock} />);

    const addFirstTableBtn = screen.getByRole('button', { name: /Add First Table/i });
    fireEvent.click(addFirstTableBtn);

    expect(onAddTableMock).toHaveBeenCalledTimes(1);
  });

  describe('Keyboard accessibility', () => {
    it('includes focus ring classes on table containers and seat circles', () => {
      render(<FloorplanCanvas {...defaultProps} />);

      const headTableContainer = screen.getByLabelText(/Head Table, shape/i);
      expect(headTableContainer.className).toContain('focus:outline-none');
      expect(headTableContainer.className).toContain('focus:ring-2');
      expect(headTableContainer.className).toContain('focus:ring-primary');

      const seat1 = screen.getByLabelText('Seat 1: John Doe');
      expect(seat1.className).toContain('focus:outline-none');
      expect(seat1.className).toContain('focus:ring-2');
      expect(seat1.className).toContain('focus:ring-primary');
    });

    it('selects a table when Enter or Space key is pressed', () => {
      const onSelectTable = jest.fn();
      render(<FloorplanCanvas {...defaultProps} onSelectTable={onSelectTable} />);

      const headTable = screen.getByLabelText(/Head Table, shape/i);

      fireEvent.keyDown(headTable, { key: 'Enter' });
      expect(onSelectTable).toHaveBeenCalledWith('table-1');

      fireEvent.keyDown(headTable, { key: ' ' });
      expect(onSelectTable).toHaveBeenCalledWith('table-1');
    });

    it('moves table position in 10px steps on Arrow keys', () => {
      const onUpdateTablePosition = jest.fn();
      render(<FloorplanCanvas {...defaultProps} onUpdateTablePosition={onUpdateTablePosition} />);

      const headTable = screen.getByLabelText(/Head Table, shape/i); // initial x: 100, y: 100

      fireEvent.keyDown(headTable, { key: 'ArrowRight' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 110, 100);

      fireEvent.keyDown(headTable, { key: 'ArrowLeft' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 90, 100);

      fireEvent.keyDown(headTable, { key: 'ArrowDown' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 100, 110);

      fireEvent.keyDown(headTable, { key: 'ArrowUp' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 100, 90);
    });

    it('moves table position in 50px steps when holding Shift with Arrow keys', () => {
      const onUpdateTablePosition = jest.fn();
      render(<FloorplanCanvas {...defaultProps} onUpdateTablePosition={onUpdateTablePosition} />);

      const headTable = screen.getByLabelText(/Head Table, shape/i);

      fireEvent.keyDown(headTable, { key: 'ArrowRight', shiftKey: true });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 150, 100);

      fireEvent.keyDown(headTable, { key: 'ArrowUp', shiftKey: true });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 100, 50);
    });

    it('clamps table position within seat-safe canvas boundaries (36px for guest tables, 0px for landmarks) when moving via Arrow keys', () => {
      const edgeTable: SeatingTableDTO = {
        id: 'table-edge',
        name: 'Edge Table',
        shape: 'rectangular',
        capacity: 2,
        x: 40,
        y: 40,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
      };
      const edgeLandmark: SeatingTableDTO = {
        id: 'landmark-edge',
        name: 'Edge Bar',
        shape: 'bar',
        capacity: 0,
        x: 5,
        y: 5,
        width: 160,
        height: 80,
        rotation: 0,
        isSample: false,
      };

      const onUpdateTablePosition = jest.fn();
      render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[edgeTable, edgeLandmark]}
          onUpdateTablePosition={onUpdateTablePosition}
        />
      );

      const tableElement = screen.getByLabelText(/Edge Table, shape/i);

      // Moving left by 10px from x=40 should clamp guest table to seat-safe 36px
      fireEvent.keyDown(tableElement, { key: 'ArrowLeft' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-edge', 36, 40);

      // Moving up by 10px from y=40 should clamp guest table to seat-safe 36px
      fireEvent.keyDown(tableElement, { key: 'ArrowUp' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-edge', 40, 36);

      // Landmark clamps to 0px
      const landmarkElement = screen.getByLabelText(/Edge Bar, landmark Bar/i);
      fireEvent.keyDown(landmarkElement, { key: 'ArrowLeft' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('landmark-edge', 0, 5);
      fireEvent.keyDown(landmarkElement, { key: 'ArrowUp' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('landmark-edge', 5, 0);
    });

    it('renders seat elements with correct tabIndex, role, and aria-labels', () => {
      render(<FloorplanCanvas {...defaultProps} />);

      const assignedSeat = screen.getByLabelText('Seat 1: John Doe');
      expect(assignedSeat).toHaveAttribute('tabIndex', '0');
      expect(assignedSeat).toHaveAttribute('role', 'button');

      const emptySeat = screen.getByLabelText('Head Table, Seat 2: Empty');
      expect(emptySeat).toHaveAttribute('tabIndex', '0');
      expect(emptySeat).toHaveAttribute('role', 'button');
    });

    it('unassigns guest when Delete or Backspace key is pressed on focused assigned seat', () => {
      const onUnassignGuest = jest.fn();
      render(<FloorplanCanvas {...defaultProps} onUnassignGuest={onUnassignGuest} />);

      const assignedSeat = screen.getByLabelText('Seat 1: John Doe');

      fireEvent.keyDown(assignedSeat, { key: 'Delete' });
      expect(onUnassignGuest).toHaveBeenCalledWith('guest-1');

      fireEvent.keyDown(assignedSeat, { key: 'Backspace' });
      expect(onUnassignGuest).toHaveBeenCalledWith('guest-1');
    });

    it('opens seat assign modal when Enter is pressed on empty seat', () => {
      const onOpenSeatAssignModal = jest.fn();
      render(<FloorplanCanvas {...defaultProps} onOpenSeatAssignModal={onOpenSeatAssignModal} />);

      const emptySeat = screen.getByLabelText('Head Table, Seat 2: Empty');
      fireEvent.keyDown(emptySeat, { key: 'Enter' });

      expect(onOpenSeatAssignModal).toHaveBeenCalledWith('table-1', 2);
    });

    it('stops event propagation on seat keydown to prevent table handler trigger', () => {
      const onSelectTable = jest.fn();
      const onUnassignGuest = jest.fn();
      render(
        <FloorplanCanvas
          {...defaultProps}
          onSelectTable={onSelectTable}
          onUnassignGuest={onUnassignGuest}
        />
      );

      const assignedSeat = screen.getByLabelText('Seat 1: John Doe');
      fireEvent.keyDown(assignedSeat, { key: 'Enter' });

      expect(onSelectTable).not.toHaveBeenCalled();
    });
  });

  describe('Rotation handles and angle controls', () => {
    it('renders rotation handle and quick angle controls when a table is selected', () => {
      render(<FloorplanCanvas {...defaultProps} selectedTableId="table-1" />);

      expect(screen.getByTestId('rotation-handle')).toBeInTheDocument();
      expect(screen.getByTestId('rotation-controls')).toBeInTheDocument();
      expect(screen.getByTestId('table-rotation-display')).toHaveTextContent('0°');
      expect(screen.getByRole('button', { name: /Rotate Head Table -45 degrees/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Rotate Head Table \+45 degrees/i })).toBeInTheDocument();
    });

    it('does not render rotation controls when no table is selected', () => {
      render(<FloorplanCanvas {...defaultProps} selectedTableId={null} />);

      expect(screen.queryByTestId('rotation-handle')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rotation-controls')).not.toBeInTheDocument();
    });

    it('triggers onUpdateTableRotation callback when quick rotation buttons are clicked', () => {
      const onUpdateTableRotation = jest.fn();
      render(
        <FloorplanCanvas
          {...defaultProps}
          selectedTableId="table-1"
          onUpdateTableRotation={onUpdateTableRotation}
        />
      );

      const rotateMinus45Btn = screen.getByRole('button', { name: /Rotate Head Table -45 degrees/i });
      fireEvent.click(rotateMinus45Btn);
      expect(onUpdateTableRotation).toHaveBeenCalledWith('table-1', 315);

      const rotatePlus45Btn = screen.getByRole('button', { name: /Rotate Head Table \+45 degrees/i });
      fireEvent.click(rotatePlus45Btn);
      expect(onUpdateTableRotation).toHaveBeenCalledWith('table-1', 45);
    });

    it('triggers onUpdateTableRotation callback on keyboard rotation shortcuts ("r", "Shift+r", "Alt+Arrows")', () => {
      const onUpdateTableRotation = jest.fn();
      render(
        <FloorplanCanvas
          {...defaultProps}
          selectedTableId="table-1"
          onUpdateTableRotation={onUpdateTableRotation}
        />
      );

      const headTable = screen.getByRole('button', { name: /^Head Table, shape/i });

      // 'r' key rotates +45 degrees
      fireEvent.keyDown(headTable, { key: 'r' });
      expect(onUpdateTableRotation).toHaveBeenCalledWith('table-1', 45);

      // 'R' with shift rotates -45 degrees (0 - 45 = 315)
      fireEvent.keyDown(headTable, { key: 'R', shiftKey: true });
      expect(onUpdateTableRotation).toHaveBeenCalledWith('table-1', 315);

      // Alt + ArrowRight rotates +15 degrees
      fireEvent.keyDown(headTable, { key: 'ArrowRight', altKey: true });
      expect(onUpdateTableRotation).toHaveBeenCalledWith('table-1', 15);

      // Alt + ArrowLeft rotates -15 degrees (0 - 15 = 345)
      fireEvent.keyDown(headTable, { key: 'ArrowLeft', altKey: true });
      expect(onUpdateTableRotation).toHaveBeenCalledWith('table-1', 345);

      // Alt + Shift + ArrowRight rotates +45 degrees
      fireEvent.keyDown(headTable, { key: 'ArrowRight', altKey: true, shiftKey: true });
      expect(onUpdateTableRotation).toHaveBeenCalledWith('table-1', 45);
    });

    it('calculates rotation angle on mouse drag on rotation handle', () => {
      const onUpdateTableRotation = jest.fn();
      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          selectedTableId="table-1"
          onUpdateTableRotation={onUpdateTableRotation}
        />
      );

      const canvasElement = container.firstElementChild as HTMLElement;
      jest.spyOn(canvasElement, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 800,
        bottom: 650,
        width: 800,
        height: 650,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const headTable = screen.getByRole('button', { name: /^Head Table, shape/i });
      const handleBtn = screen.getByRole('button', { name: /Rotate handle for Head Table/i });
      fireEvent.mouseDown(handleBtn, { button: 0, clientX: 160, clientY: 90 });

      // Mouse at (160, 220): table center is x=100+60=160, y=100+60=160
      // Vector dx = 0, dy = 60 (pointing down, 180 degrees)
      fireEvent.mouseMove(canvasElement, { clientX: 160, clientY: 220 });
      expect(headTable.style.transform).toBe('rotate(180deg)');
      expect(screen.getByTestId('table-rotation-display')).toHaveTextContent('180°');
      expect(onUpdateTableRotation).not.toHaveBeenCalled();

      // Mouse up commits final rotation once and ends gesture
      fireEvent.mouseUp(canvasElement);
      expect(onUpdateTableRotation).toHaveBeenCalledTimes(1);
      expect(onUpdateTableRotation).toHaveBeenCalledWith('table-1', 180);

      fireEvent.mouseMove(canvasElement, { clientX: 200, clientY: 200 });
      expect(onUpdateTableRotation).toHaveBeenCalledTimes(1);
    });

    it('normalizes rotation angles correctly to 0-359 degrees range', () => {
      const rotatedTable: SeatingTableDTO = {
        ...mockTables[0],
        rotation: 350,
      };

      const onUpdateTableRotation = jest.fn();
      render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[rotatedTable]}
          selectedTableId="table-1"
          onUpdateTableRotation={onUpdateTableRotation}
        />
      );

      const headTable = screen.getByRole('button', { name: /^Head Table, shape/i });

      // 350 + 45 = 395 -> normalized to 35
      fireEvent.keyDown(headTable, { key: 'r' });
      expect(onUpdateTableRotation).toHaveBeenCalledWith('table-1', 35);
    });

    it('flips rotation-handle to -bottom-[76px] with flex-col-reverse near top and rotated borders, avoids toolbar overlap, and rotates smoothly without angle jumps', () => {
      const onUpdateTableRotation = jest.fn();
      const onUpdateTablePosition = jest.fn();
      const topEdgeTable: SeatingTableDTO = {
        id: 'tbl-top-edge',
        name: 'Top Edge Table',
        shape: 'round',
        capacity: 8,
        x: 0, // legacy saved at 0 -> renders clamped at 36 without mutating DB
        y: 0,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      };

      const { container, rerender } = render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[topEdgeTable]}
          selectedTableId="tbl-top-edge"
          onUpdateTableRotation={onUpdateTableRotation}
          onUpdateTablePosition={onUpdateTablePosition}
        />
      );

      const canvasElement = container.firstElementChild as HTMLElement;
      jest.spyOn(canvasElement, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 800,
        bottom: 650,
        width: 800,
        height: 650,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Legacy table saved at (0, 0) renders at seat-safe (36px, 36px) without mutating DB
      const tableNode = screen.getByRole('button', { name: /^Top Edge Table, shape/i });
      expect(tableNode.style.left).toBe('36px');
      expect(tableNode.style.top).toBe('36px');
      expect(onUpdateTablePosition).not.toHaveBeenCalled();

      // Plain click selection on legacy table does not mutate DB
      fireEvent.mouseDown(tableNode, { button: 0, clientX: 80, clientY: 80 });
      fireEvent.mouseUp(tableNode, { clientX: 80, clientY: 80 });
      fireEvent.click(tableNode, { clientX: 80, clientY: 80 });
      expect(onUpdateTablePosition).not.toHaveBeenCalled();

      // Top pole (36 + 60 - 122 = -26) crosses top border -> flips to -bottom-[76px] with flex-col-reverse
      const rotationHandle = screen.getByTestId('rotation-handle');
      expect(rotationHandle.className).toContain('-bottom-[76px]');
      expect(rotationHandle.className).toContain('flex-col-reverse');
      expect(rotationHandle.className).not.toContain('-top-[76px]');

      // Floating toolbar also flips below table AND clears the flipped rotation-handle (toolbarLocalY >= cy + 150 = 210 > handle knob center 182)
      const toolbar = screen.getByTestId('rotation-controls');
      expect(parseFloat(toolbar.style.top)).toBeGreaterThanOrEqual(210);

      // Dragging flipped handle directly below center (center = 96, 96; pointer at 96, 218 -> 0 deg; move slightly left to 3 o'clock/9 o'clock):
      // At 9 o'clock (dx = -60, dy = 0 -> clientX = 36, clientY = 96), flipped bottom pole at 9 o'clock means table rotation = 90 deg (no 180 deg jump!)
      const handleBtn = screen.getByRole('button', { name: /Rotate handle for Top Edge Table/i });
      fireEvent.mouseDown(handleBtn, { button: 0, clientX: 96, clientY: 218 });
      fireEvent.mouseMove(canvasElement, { clientX: 96, clientY: 219 });
      expect(tableNode.style.transform).toBe('rotate(0deg)');
      fireEvent.mouseMove(canvasElement, { clientX: 36, clientY: 96 });
      expect(tableNode.style.transform).toBe('rotate(90deg)');
      fireEvent.mouseUp(canvasElement);
      expect(onUpdateTableRotation).toHaveBeenCalledWith('tbl-top-edge', 90);

      // Rotated 270 deg near left border (x=36, y=220) -> top pole points left (-26 < 0) and flips away from left border
      rerender(
        <FloorplanCanvas
          {...defaultProps}
          tables={[{ ...topEdgeTable, x: 36, y: 220, rotation: 270 }]}
          selectedTableId="tbl-top-edge"
          onUpdateTableRotation={onUpdateTableRotation}
          onUpdateTablePosition={onUpdateTablePosition}
        />
      );
      expect(screen.getByTestId('rotation-handle').className).toContain('-bottom-[76px]');
      expect(screen.getByTestId('rotation-handle').className).toContain('flex-col-reverse');

      // Rotated 90 deg near right border (x=680, y=220 on 800px stage) -> top pole points right (862 > 800) and flips away from right border
      rerender(
        <FloorplanCanvas
          {...defaultProps}
          tables={[{ ...topEdgeTable, x: 680, y: 220, rotation: 90 }]}
          selectedTableId="tbl-top-edge"
          onUpdateTableRotation={onUpdateTableRotation}
          onUpdateTablePosition={onUpdateTablePosition}
        />
      );
      expect(screen.getByTestId('rotation-handle').className).toContain('-bottom-[76px]');
      expect(screen.getByTestId('rotation-handle').className).toContain('flex-col-reverse');
    });
  });

  describe('Pointer gesture buffering and release commits', () => {
    const mockCanvasRect = (canvasElement: HTMLElement) => {
      jest.spyOn(canvasElement, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 800,
        bottom: 650,
        width: 800,
        height: 650,
        x: 0,
        y: 0,
        toJSON: () => {},
      });
    };

    it('renders live preview positions across a 120-frame pointer drag without saving until mouseup', () => {
      const onUpdateTablePosition = jest.fn();
      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          onUpdateTablePosition={onUpdateTablePosition}
        />
      );

      const canvasElement = container.firstElementChild as HTMLElement;
      mockCanvasRect(canvasElement);

      const headTable = screen.getByRole('button', { name: /^Head Table, shape/i });
      // Initial table position is (100, 100); pointer grabs at (120, 130) -> offset (20, 30)
      fireEvent.mouseDown(headTable, { button: 0, clientX: 120, clientY: 130 });

      for (let frame = 1; frame <= 120; frame++) {
        const nextX = 100 + frame * 2;
        const nextY = 100 + frame;
        fireEvent.mouseMove(canvasElement, {
          clientX: nextX + 20,
          clientY: nextY + 30,
        });
        expect(headTable.style.left).toBe(`${nextX}px`);
        expect(headTable.style.top).toBe(`${nextY}px`);
      }

      expect(onUpdateTablePosition).not.toHaveBeenCalled();

      fireEvent.mouseUp(canvasElement);
      expect(onUpdateTablePosition).toHaveBeenCalledTimes(1);
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 340, 220);
      expect(screen.getByText('Head Table moved to X 340, Y 220')).toBeInTheDocument();
    });

    it('renders live preview angles across a 15-frame rotation drag and commits once on mouseup', () => {
      const onUpdateTableRotation = jest.fn();
      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          selectedTableId="table-1"
          onUpdateTableRotation={onUpdateTableRotation}
        />
      );

      const canvasElement = container.firstElementChild as HTMLElement;
      mockCanvasRect(canvasElement);

      const headTable = screen.getByRole('button', { name: /^Head Table, shape/i });
      const handleBtn = screen.getByRole('button', { name: /Rotate handle for Head Table/i });
      fireEvent.mouseDown(handleBtn, { button: 0, clientX: 160, clientY: 90 });

      // Sweep 15 frames around table center (160, 160), ending directly right (220, 160 -> 90 deg)
      for (let frame = 1; frame <= 15; frame++) {
        const angleRad = ((frame * 6) - 90) * (Math.PI / 180);
        const clientX = 160 + Math.cos(angleRad) * 60;
        const clientY = 160 + Math.sin(angleRad) * 60;
        fireEvent.mouseMove(canvasElement, { clientX, clientY });
      }

      expect(headTable.style.transform).toBe('rotate(90deg)');
      expect(screen.getByTestId('table-rotation-display')).toHaveTextContent('90°');
      expect(onUpdateTableRotation).not.toHaveBeenCalled();

      fireEvent.mouseUp(canvasElement);
      expect(onUpdateTableRotation).toHaveBeenCalledTimes(1);
      expect(onUpdateTableRotation).toHaveBeenCalledWith('table-1', 90);
      expect(screen.getByText('Head Table rotated to 90 degrees')).toBeInTheDocument();
    });

    it('commits clamped placement using table width and height when releasing pointer outside the canvas', () => {
      const wideTable: SeatingTableDTO = {
        id: 'table-wide',
        name: 'Banquet Table',
        shape: 'rectangular',
        capacity: 6,
        x: 100,
        y: 100,
        width: 260,
        height: 100,
        rotation: 0,
        isSample: false,
      };
      const onUpdateTablePosition = jest.fn();
      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[wideTable]}
          onUpdateTablePosition={onUpdateTablePosition}
        />
      );

      const canvasElement = container.firstElementChild as HTMLElement;
      mockCanvasRect(canvasElement);

      const tableElement = screen.getByRole('button', { name: /^Banquet Table, shape/i });
      fireEvent.mouseDown(tableElement, { button: 0, clientX: 110, clientY: 110 });

      // Move far outside 800x650 canvas; maxX = 800 - 260 = 540, maxY = 650 - 100 = 550
      fireEvent.mouseMove(window, { clientX: 1200, clientY: 950 });
      expect(tableElement.style.left).toBe('540px');
      expect(tableElement.style.top).toBe('550px');
      expect(onUpdateTablePosition).not.toHaveBeenCalled();

      // Release outside the canvas on window
      fireEvent.mouseUp(window);
      expect(onUpdateTablePosition).toHaveBeenCalledTimes(1);
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-wide', 540, 550);
    });

    it('cancels active drag and rotation gestures on Escape without saving', () => {
      const onUpdateTablePosition = jest.fn();
      const onUpdateTableRotation = jest.fn();
      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          selectedTableId="table-1"
          onUpdateTablePosition={onUpdateTablePosition}
          onUpdateTableRotation={onUpdateTableRotation}
        />
      );

      const canvasElement = container.firstElementChild as HTMLElement;
      mockCanvasRect(canvasElement);

      const headTable = screen.getByRole('button', { name: /^Head Table, shape/i });

      // 1. Start drag, move, then press Escape
      fireEvent.mouseDown(headTable, { button: 0, clientX: 110, clientY: 110 });
      fireEvent.mouseMove(canvasElement, { clientX: 310, clientY: 260 });
      expect(headTable.style.left).toBe('300px');
      expect(headTable.style.top).toBe('250px');

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(headTable.style.left).toBe('100px');
      expect(headTable.style.top).toBe('100px');

      fireEvent.mouseUp(window);
      expect(onUpdateTablePosition).not.toHaveBeenCalled();

      // 2. Start rotation, move, then press Escape
      const handleBtn = screen.getByRole('button', { name: /Rotate handle for Head Table/i });
      fireEvent.mouseDown(handleBtn, { button: 0, clientX: 160, clientY: 90 });
      fireEvent.mouseMove(canvasElement, { clientX: 220, clientY: 160 });
      expect(headTable.style.transform).toBe('rotate(90deg)');

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(headTable.style.transform).toBe('rotate(0deg)');

      fireEvent.mouseUp(window);
      expect(onUpdateTableRotation).not.toHaveBeenCalled();
    });

    it('selects table or activates seat on click without sending position or rotation updates', () => {
      const onSelectTable = jest.fn();
      const onUpdateTablePosition = jest.fn();
      const onUpdateTableRotation = jest.fn();
      const onOpenSeatAssignModal = jest.fn();

      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          selectedTableId="table-1"
          onSelectTable={onSelectTable}
          onUpdateTablePosition={onUpdateTablePosition}
          onUpdateTableRotation={onUpdateTableRotation}
          onOpenSeatAssignModal={onOpenSeatAssignModal}
        />
      );

      const canvasElement = container.firstElementChild as HTMLElement;
      mockCanvasRect(canvasElement);

      // Click table without changing coordinates
      const headTable = screen.getByRole('button', { name: /^Head Table, shape/i });
      fireEvent.mouseDown(headTable, { button: 0, clientX: 150, clientY: 150 });
      fireEvent.mouseUp(headTable, { clientX: 150, clientY: 150 });
      fireEvent.click(headTable, { clientX: 150, clientY: 150 });

      expect(onSelectTable).toHaveBeenCalledWith('table-1');
      expect(onUpdateTablePosition).not.toHaveBeenCalled();

      // Drag table away and back to starting coordinates before release -> no save
      fireEvent.mouseDown(headTable, { button: 0, clientX: 150, clientY: 150 });
      fireEvent.mouseMove(canvasElement, { clientX: 250, clientY: 250 });
      fireEvent.mouseMove(canvasElement, { clientX: 150, clientY: 150 });
      fireEvent.mouseUp(canvasElement, { clientX: 150, clientY: 150 });
      expect(onUpdateTablePosition).not.toHaveBeenCalled();

      // Click empty seat -> opens modal without dragging or saving table
      onSelectTable.mockClear();
      const emptySeat = screen.getByLabelText('Head Table, Seat 2: Empty');
      fireEvent.mouseDown(emptySeat, { button: 0, clientX: 160, clientY: 238 });
      fireEvent.mouseMove(canvasElement, { clientX: 165, clientY: 242 });
      fireEvent.mouseUp(emptySeat, { clientX: 165, clientY: 242 });
      fireEvent.click(emptySeat, { clientX: 165, clientY: 242 });

      expect(onOpenSeatAssignModal).toHaveBeenCalledWith('table-1', 2);
      expect(onSelectTable).not.toHaveBeenCalled();
      expect(onUpdateTablePosition).not.toHaveBeenCalled();
      expect(onUpdateTableRotation).not.toHaveBeenCalled();
    });
  });

  describe('1-sided head/sweetheart tables, dietary badges, and household batch drops', () => {
    it('places all seats along one side (top edge) for head and sweetheart tables', () => {
      const headTable: SeatingTableDTO = {
        id: 'tbl-head',
        name: 'Bridal Party Head Table',
        shape: 'head',
        capacity: 4,
        x: 100,
        y: 100,
        width: 250,
        height: 90,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      };

      render(<FloorplanCanvas {...defaultProps} tables={[headTable]} />);

      const seats = [1, 2, 3, 4].map((n) =>
        screen.getByLabelText(`Bridal Party Head Table, Seat ${n}: Empty`)
      );
      const tops = seats.map((s) => s.style.top);
      const lefts = seats.map((s) => parseFloat(s.style.left));

      // Every seat sits along the same single edge (top: -18px) with monotonically increasing X
      expect(tops).toEqual(['-18px', '-18px', '-18px', '-18px']);
      expect(lefts[0]).toBeLessThan(lefts[1]);
      expect(lefts[1]).toBeLessThan(lefts[2]);
      expect(lefts[2]).toBeLessThan(lefts[3]);
      seats.forEach((s) => expect(s).toHaveAttribute('data-seat-side', 'single'));
    });

    it('renders seat dietary badge indicator and accessible dietary label on FloorplanCanvas', () => {
      const sweetheartTable: SeatingTableDTO = {
        id: 'tbl-sweet',
        name: 'Sweetheart Table',
        shape: 'sweetheart',
        capacity: 2,
        x: 120,
        y: 120,
        width: 140,
        height: 80,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'g-diet',
            code: 'BRIDE1',
            guestName: 'Taylor Morgan',
            seatNumber: 1,
            dietaryNotes: 'Gluten-Free',
          } as InvitationCodeDTO,
        ],
      };

      render(<FloorplanCanvas {...defaultProps} tables={[sweetheartTable]} />);

      const seat = screen.getByLabelText('Seat 1: Taylor Morgan, Dietary: Gluten-Free');
      expect(seat).toBeInTheDocument();
      const badge = screen.getByTestId('seat-dietary-badge');
      expect(badge).toHaveTextContent('GF');
    });

    it('invokes onDropGuestsOnTable for household drops when capacity permits and announces if capacity is insufficient', () => {
      const onDropGuestsOnTable = jest.fn();
      const smallTable: SeatingTableDTO = {
        id: 'tbl-small',
        name: 'Small Table',
        shape: 'round',
        capacity: 2,
        x: 100,
        y: 100,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
        invitationCodes: [{ id: 'g-existing', guestName: 'Seated Guest', seatNumber: 1 } as InvitationCodeDTO],
      };

      const { rerender } = render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[smallTable]}
          onDropGuestsOnTable={onDropGuestsOnTable}
        />
      );

      const tableEl = screen.getByRole('button', { name: /Small Table, shape/i });

      // 2-member household dropped onto table with only 1 open seat -> rejected with announcement
      fireEvent.drop(tableEl, {
        dataTransfer: {
          getData: (fmt: string) => (fmt === 'text/plain' ? 'household:g-h1,g-h2' : ''),
        },
      });
      expect(onDropGuestsOnTable).not.toHaveBeenCalled();
      expect(
        screen.getByText('Table "Small Table" only has 1 open seat for 2 household members.')
      ).toBeInTheDocument();

      // Increase capacity to 4 -> household drop succeeds
      rerender(
        <FloorplanCanvas
          {...defaultProps}
          tables={[{ ...smallTable, capacity: 4 }]}
          onDropGuestsOnTable={onDropGuestsOnTable}
        />
      );
      fireEvent.drop(screen.getByRole('button', { name: /Small Table, shape/i }), {
        dataTransfer: {
          getData: (fmt: string) => (fmt === 'text/plain' ? 'household:g-h1,g-h2' : ''),
        },
      });
      expect(onDropGuestsOnTable).toHaveBeenCalledWith(['g-h1', 'g-h2'], 'tbl-small');
    });
  });

  describe('Seat resolution, 4-edge rectangular layout, scrollable stage, touch pointer drag, and >= 24x24px targets', () => {
    it('does not duplicate sparse explicit seats onto empty lower seats and opens assign modal when clicking empty Seat 1', () => {
      const onUnassignGuest = jest.fn();
      const onOpenSeatAssignModal = jest.fn();
      const sparseHeadTable: SeatingTableDTO = {
        id: 'table-head',
        name: 'Sparse Head Table',
        shape: 'rectangular',
        capacity: 8,
        x: 275,
        y: 40,
        width: 250,
        height: 100,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'guest-bride',
            code: 'BRIDE1',
            guestName: 'Bride Guest',
            tableId: 'table-head',
            seatNumber: 2,
          } as InvitationCodeDTO,
          {
            id: 'guest-groom',
            code: 'GROOM1',
            guestName: 'Groom Guest',
            tableId: 'table-head',
            seatNumber: 3,
          } as InvitationCodeDTO,
        ],
      };

      render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[sparseHeadTable]}
          onUnassignGuest={onUnassignGuest}
          onOpenSeatAssignModal={onOpenSeatAssignModal}
        />
      );

      const seat1 = screen.getByLabelText('Sparse Head Table, Seat 1: Empty');
      const seat2 = screen.getByLabelText('Seat 2: Bride Guest');
      const seat3 = screen.getByLabelText('Seat 3: Groom Guest');
      const seat4 = screen.getByLabelText('Sparse Head Table, Seat 4: Empty');
      expect(seat1).toBeInTheDocument();
      expect(seat2).toBeInTheDocument();
      expect(seat3).toBeInTheDocument();
      expect(seat4).toBeInTheDocument();

      fireEvent.click(seat1);
      expect(onOpenSeatAssignModal).toHaveBeenCalledWith('table-head', 1);
      expect(onUnassignGuest).not.toHaveBeenCalled();
    });

    it('assigns unnumbered seated guests to the lowest unoccupied seat without overwriting explicit seatNumber occupants', () => {
      const mixedTable: SeatingTableDTO = {
        id: 'table-mixed',
        name: 'Mixed Table',
        shape: 'round',
        capacity: 4,
        x: 100,
        y: 100,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'guest-unnumbered',
            code: 'UNNUM1',
            guestName: 'Unnumbered One',
            tableId: 'table-mixed',
            seatNumber: null,
          } as InvitationCodeDTO,
          {
            id: 'guest-explicit-1',
            code: 'EXP1',
            guestName: 'Explicit One',
            tableId: 'table-mixed',
            seatNumber: 1,
          } as InvitationCodeDTO,
        ],
      };

      render(<FloorplanCanvas {...defaultProps} tables={[mixedTable]} />);

      expect(screen.getByLabelText('Seat 1: Explicit One')).toBeInTheDocument();
      expect(screen.getByLabelText('Seat 2: Unnumbered One')).toBeInTheDocument();
      expect(screen.getByLabelText('Mixed Table, Seat 3: Empty')).toBeInTheDocument();
      expect(screen.getByLabelText('Mixed Table, Seat 4: Empty')).toBeInTheDocument();
    });

    it('distributes rectangular table seats evenly across all four edges within 0..width and 0..height', () => {
      const rectTable: SeatingTableDTO = {
        id: 'table-rect-8',
        name: 'Banquet 8',
        shape: 'rectangular',
        capacity: 8,
        x: 100,
        y: 100,
        width: 250,
        height: 100,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      };

      render(<FloorplanCanvas {...defaultProps} tables={[rectTable]} />);

      const getCoords = (seatNum: number) => {
        const el = screen.getByLabelText(`Banquet 8, Seat ${seatNum}: Empty`);
        return {
          left: parseFloat(el.style.left),
          top: parseFloat(el.style.top),
        };
      };

      expect(getCoords(1).left).toBeCloseTo(250 / 3, 5);
      expect(getCoords(1).top).toBe(-16);
      expect(getCoords(2).left).toBeCloseTo((250 * 2) / 3, 5);
      expect(getCoords(2).top).toBe(-16);
      expect(getCoords(3).left).toBe(266);
      expect(getCoords(3).top).toBeCloseTo(100 / 3, 5);
      expect(getCoords(4).left).toBe(266);
      expect(getCoords(4).top).toBeCloseTo((100 * 2) / 3, 5);
      expect(getCoords(5).left).toBeCloseTo((250 * 2) / 3, 5);
      expect(getCoords(5).top).toBe(116);
      expect(getCoords(6).left).toBeCloseTo(250 / 3, 5);
      expect(getCoords(6).top).toBe(116);
      expect(getCoords(7).left).toBe(-16);
      expect(getCoords(7).top).toBeCloseTo((100 * 2) / 3, 5);
      expect(getCoords(8).left).toBe(-16);
      expect(getCoords(8).top).toBeCloseTo(100 / 3, 5);
    });

    it('renders an overflow-auto container with a scrollable inner stage expanding to encompass off-screen tables', () => {
      const farTable: SeatingTableDTO = {
        id: 'table-far',
        name: 'East Wing Table',
        shape: 'rectangular',
        capacity: 6,
        x: 1050,
        y: 620,
        width: 250,
        height: 100,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      };

      const { container } = render(<FloorplanCanvas {...defaultProps} tables={[farTable]} />);
      const canvasElement = container.firstElementChild as HTMLElement;
      expect(canvasElement.className).toContain('overflow-auto');

      const stage = screen.getByTestId('floorplan-stage');
      expect(stage.style.minWidth).toBe('1348px');
      expect(stage.style.minHeight).toBe('768px');
    });

    it('supports touch Pointer Events for dragging and rotating tables on a scrolled narrow viewport and cancels cleanly on pointerCancel', () => {
      const onUpdateTablePosition = jest.fn();
      const onUpdateTableRotation = jest.fn();
      const mobileTable: SeatingTableDTO = {
        id: 'table-mobile',
        name: 'Mobile Table',
        shape: 'round',
        capacity: 4,
        x: 500,
        y: 120,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      };

      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[mobileTable]}
          selectedTableId="table-mobile"
          onUpdateTablePosition={onUpdateTablePosition}
          onUpdateTableRotation={onUpdateTableRotation}
        />
      );

      const canvasElement = container.firstElementChild as HTMLElement;
      Object.defineProperty(canvasElement, 'scrollLeft', { value: 400, writable: true, configurable: true });
      Object.defineProperty(canvasElement, 'scrollTop', { value: 0, writable: true, configurable: true });
      jest.spyOn(canvasElement, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 340,
        bottom: 650,
        width: 340,
        height: 650,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const tableEl = screen.getByRole('button', { name: /^Mobile Table, shape/i });
      expect(tableEl.className).toContain('touch-none');

      // Stage X = clientX(120) + scrollLeft(400) = 520 -> offset = 20
      fireEvent.pointerDown(tableEl, { button: 0, pointerId: 7, pointerType: 'touch', clientX: 120, clientY: 140 });
      fireEvent.pointerMove(tableEl, { pointerId: 7, pointerType: 'touch', clientX: 220, clientY: 190 });
      expect(tableEl.style.left).toBe('600px');
      expect(tableEl.style.top).toBe('170px');
      expect(onUpdateTablePosition).not.toHaveBeenCalled();

      fireEvent.pointerUp(tableEl, { pointerId: 7, pointerType: 'touch', clientX: 220, clientY: 190 });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-mobile', 600, 170);

      // Pointer cancel reverts preview without saving
      onUpdateTablePosition.mockClear();
      fireEvent.pointerDown(tableEl, { button: 0, pointerId: 8, pointerType: 'touch', clientX: 120, clientY: 140 });
      fireEvent.pointerMove(tableEl, { pointerId: 8, pointerType: 'touch', clientX: 240, clientY: 220 });
      expect(tableEl.style.left).toBe('620px');

      fireEvent.pointerCancel(tableEl, { pointerId: 8, pointerType: 'touch' });
      expect(tableEl.style.left).toBe('500px');
      expect(onUpdateTablePosition).not.toHaveBeenCalled();
    });

    it('sizes floorplan rotation handle and quick-rotate buttons to at least 24x24px and passes jest-axe with 1-sided dietary seats', async () => {
      const a11yTables: SeatingTableDTO[] = [
        ...mockTables,
        {
          id: 'tbl-sweet-a11y',
          name: 'Sweetheart Table',
          shape: 'sweetheart',
          capacity: 2,
          x: 500,
          y: 120,
          width: 140,
          height: 80,
          rotation: 0,
          isSample: false,
          invitationCodes: [
            {
              id: 'g-diet-a11y',
              code: 'BRIDE99',
              guestName: 'Taylor Morgan',
              tableId: 'tbl-sweet-a11y',
              seatNumber: 1,
              dietaryNotes: 'Vegan',
            } as InvitationCodeDTO,
          ],
        },
      ];

      const { container } = render(
        <FloorplanCanvas {...defaultProps} tables={a11yTables} selectedTableId="table-1" />
      );

      const handleBtn = screen.getByRole('button', { name: /Rotate handle for Head Table/i });
      expect(handleBtn.className).toContain('w-7');
      expect(handleBtn.className).toContain('h-7');

      const minus45Btn = screen.getByRole('button', { name: /Rotate Head Table -45 degrees/i });
      const plus45Btn = screen.getByRole('button', { name: /Rotate Head Table \+45 degrees/i });
      expect(minus45Btn.className).toContain('min-w-7');
      expect(minus45Btn.className).toContain('min-h-6');
      expect(plus45Btn.className).toContain('min-w-7');
      expect(plus45Btn.className).toContain('min-h-6');

      // Also verify 1-sided table node exposes data-seat-side="single" markers inside role="button"
      const sweetheartNode = screen.getByRole('button', { name: /^Sweetheart Table, shape/i });
      expect(sweetheartNode.querySelectorAll('[data-seat-side="single"]')).toHaveLength(2);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('selects table on single-click of occupied seat dot, unassigns on double-click or keyboard Delete, and renders companion chairs', async () => {
      const onSelectTable = jest.fn();
      const onUnassignGuest = jest.fn();
      const coupleTable: SeatingTableDTO = {
        id: 'table-couple',
        name: 'Garden Table',
        shape: 'round',
        capacity: 4,
        x: 120,
        y: 120,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'g-couple-1',
            code: 'CPL01',
            guestName: 'Jordan Taylor',
            tableId: 'table-couple',
            seatNumber: 1,
            used: true,
            isSample: false,
            partyTags: [],
            plusOneAllocations: 1,
            extraFields: {
              attending: true,
              plusOneCount: 1,
              plusOneNames: ['Morgan Taylor'],
            },
          } as InvitationCodeDTO,
        ],
      };

      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[coupleTable]}
          onSelectTable={onSelectTable}
          onUnassignGuest={onUnassignGuest}
        />
      );

      // Party of 2 occupies 2 / 4 seats with contiguous companion chair at Seat 2
      expect(screen.getByText('2 / 4 seats')).toBeInTheDocument();
      const primarySeat = screen.getByLabelText('Seat 1: Jordan Taylor');
      const companionSeat = screen.getByLabelText('Seat 2: Morgan Taylor (Jordan Taylor +1)');
      expect(primarySeat).toBeInTheDocument();
      expect(companionSeat).toBeInTheDocument();

      // Single-click selects the table and does NOT unassign
      fireEvent.click(primarySeat);
      expect(onSelectTable).toHaveBeenCalledWith('table-couple');
      expect(onUnassignGuest).not.toHaveBeenCalled();

      // Double-click unassigns the guest and announces via aria-live
      fireEvent.doubleClick(companionSeat);
      expect(onUnassignGuest).toHaveBeenCalledWith('g-couple-1');
      expect(
        screen.getByText('Jordan Taylor unassigned from Garden Table Seat 2')
      ).toBeInTheDocument();

      // Keyboard Delete still unassigns
      onUnassignGuest.mockClear();
      fireEvent.keyDown(primarySeat, { key: 'Delete' });
      expect(onUnassignGuest).toHaveBeenCalledWith('g-couple-1');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Inline plus-one chairs and zero-capacity landmarks', () => {
    it('renders distinct inline chairs for plus-ones with +1 badges and blocks multi-chair overflow drops', () => {
      const onDropGuestOnTable = jest.fn();
      const tableWithPlusOnes: SeatingTableDTO = {
        id: 'tbl-plus',
        name: 'Garden Table',
        shape: 'round',
        capacity: 4,
        x: 80,
        y: 80,
        width: 130,
        height: 130,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'g-host',
            code: 'HOST1',
            guestName: 'Alex Rivera',
            tableId: 'tbl-plus',
            seatNumber: 1,
            plusOneSeatNumbers: [2],
            plusOneAllocations: 1,
            partyTags: [],
            isSample: false,
            used: true,
            extraFields: { attending: true, plusOneNames: ['Jordan Rivera'] },
          },
        ],
      };

      const incomingPartyOfThree: InvitationCodeDTO = {
        id: 'g-incoming-3',
        code: 'INC3',
        guestName: 'Sam Patel',
        tableId: null,
        seatNumber: null,
        plusOneSeatNumbers: [],
        plusOneAllocations: 2,
        partyTags: [],
        isSample: false,
        used: true,
        extraFields: { attending: true, plusOneNames: ['Plus One 1', 'Plus One 2'] },
      };

      render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[tableWithPlusOnes]}
          allGuests={[...(tableWithPlusOnes.invitationCodes ?? []), incomingPartyOfThree]}
          onDropGuestOnTable={onDropGuestOnTable}
        />
      );

      // Seat 1 is primary guest Alex Rivera; Seat 2 is plus-one Jordan Rivera
      expect(screen.getByRole('button', { name: 'Seat 1: Alex Rivera' })).not.toHaveAttribute('data-is-plus-one');
      const plusOneChair = screen.getByRole('button', { name: /Seat 2: Jordan Rivera \(Alex Rivera \+1\)/i });
      expect(plusOneChair).toHaveAttribute('data-is-plus-one', 'true');
      expect(screen.getByTestId('seat-plus-one-badge')).toHaveTextContent('+1');

      // Dropping incomingPartyOfThree (3 chairs needed) onto Garden Table (only 2 open chairs: seats 3 & 4) is blocked
      const tableNode = screen.getByRole('button', { name: /^Garden Table, shape/i });
      fireEvent.drop(tableNode, {
        dataTransfer: {
          getData: (format: string) => (format === 'text/plain' ? 'g-incoming-3' : ''),
        },
      });
      expect(onDropGuestOnTable).not.toHaveBeenCalled();
      expect(
        screen.getByText('Table "Garden Table" only has 2 open seats for Sam Patel (3 chairs needed).')
      ).toBeInTheDocument();
    });

    it('renders draggable, rotatable zero-capacity landmarks without chairs and rejects guest drops', () => {
      const onDropGuestOnTable = jest.fn();
      const onUpdateTablePosition = jest.fn();
      const onUpdateTableRotation = jest.fn();
      const danceFloor: SeatingTableDTO = {
        id: 'lm-1',
        name: 'Main Dance Floor',
        shape: 'dance-floor',
        capacity: 0,
        x: 200,
        y: 160,
        width: 220,
        height: 180,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      };

      render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[danceFloor]}
          selectedTableId="lm-1"
          onDropGuestOnTable={onDropGuestOnTable}
          onUpdateTablePosition={onUpdateTablePosition}
          onUpdateTableRotation={onUpdateTableRotation}
        />
      );

      const landmarkNode = screen.getByRole('button', {
        name: /Main Dance Floor, landmark Dance Floor, 0 seats/i,
      });
      expect(landmarkNode).toHaveAttribute('data-table-landmark', 'true');
      expect(landmarkNode.querySelectorAll('[data-seat-number]')).toHaveLength(0);

      // Supports keyboard drag & rotation
      fireEvent.keyDown(landmarkNode, { key: 'ArrowRight' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('lm-1', 210, 160);
      fireEvent.keyDown(landmarkNode, { key: 'r' });
      expect(onUpdateTableRotation).toHaveBeenCalledWith('lm-1', 45);

      // Rejects guest drops
      fireEvent.drop(landmarkNode, {
        dataTransfer: {
          getData: (format: string) => (format === 'text/plain' ? 'guest-1' : ''),
        },
      });
      expect(onDropGuestOnTable).not.toHaveBeenCalled();
      expect(
        screen.getByText('Cannot assign guests to landmark "Main Dance Floor".')
      ).toBeInTheDocument();
    });

    it('scales 50-seat tables, keeps rotation-handle clear of top seat, counter-rotates inline nudge controls, and supports Place mode + Escape exit', () => {
      const onUpdateTablePosition = jest.fn();
      const onPlacementModeChange = jest.fn();
      const rotatedGalaTable: SeatingTableDTO = {
        id: 'tbl-50',
        name: 'Gala Round 50',
        shape: 'round',
        capacity: 50,
        x: 240,
        y: 220,
        width: 120,
        height: 120,
        rotation: 45,
        isSample: false,
        invitationCodes: [],
      };

      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[rotatedGalaTable]}
          selectedTableId="tbl-50"
          onUpdateTablePosition={onUpdateTablePosition}
          onPlacementModeChange={onPlacementModeChange}
        />
      );

      const tableEl = screen.getByRole('button', { name: /Gala Round 50, shape round, capacity 50/i });
      // Scaled perimeter is much larger than the raw 120px width/height
      expect(parseFloat(tableEl.style.width)).toBeGreaterThan(500);
      expect(parseFloat(tableEl.style.height)).toBeGreaterThan(500);

      // Rotation handle sits at -top-[76px] (center -62px, counter-rotated), >=44px clear of top seat (center -18px)
      const rotationHandle = screen.getByTestId('rotation-handle');
      expect(rotationHandle.className).toContain('-top-[76px]');
      expect(rotationHandle.firstElementChild?.className).toContain('w-7 h-7 rounded-full');
      expect((rotationHandle.firstElementChild as HTMLElement).style.transform).toContain('rotate(-45deg)');

      // Counter-rotated inline floating toolbar so directional buttons follow screen axes
      const floatingToolbar = screen.getByRole('toolbar', {
        name: /Gala Round 50 position and rotation controls/i,
      });
      expect(floatingToolbar).toHaveAttribute('data-testid', 'rotation-controls');
      expect(floatingToolbar.style.transform).toContain('rotate(-45deg)');

      fireEvent.click(screen.getByRole('button', { name: 'Nudge Gala Round 50 left' }));
      expect(onUpdateTablePosition).toHaveBeenCalledWith('tbl-50', 220, 220);

      fireEvent.click(screen.getByRole('button', { name: 'Nudge Gala Round 50 down' }));
      expect(onUpdateTablePosition).toHaveBeenCalledWith('tbl-50', 240, 240);

      // Toggle active placement mode via Place button
      const placeToggle = screen.getByRole('button', { name: /^Place/i });
      expect(placeToggle).toHaveAccessibleName('Place for Gala Round 50');
      expect(placeToggle).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(placeToggle);
      expect(onPlacementModeChange).toHaveBeenCalledWith(true);
      expect(placeToggle).toHaveAttribute('aria-pressed', 'true');

      // Clicking open canvas spots moves the selected table there and announces X/Y while staying in placement mode until toggled or Escape
      const canvasRoot = container.firstElementChild as HTMLElement;
      jest.spyOn(canvasRoot, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 1200,
        bottom: 900,
        width: 1200,
        height: 900,
        x: 0,
        y: 0,
        toJSON: () => {},
      });
      fireEvent.click(canvasRoot, { clientX: 500, clientY: 450 });
      expect(onUpdateTablePosition).toHaveBeenCalledTimes(3);
      expect(placeToggle).toHaveAttribute('aria-pressed', 'true');
      const liveRegion = container.querySelector('[aria-live="polite"]');
      expect(liveRegion?.textContent).toMatch(/Gala Round 50 moved to X \d+, Y \d+/);

      // Verify Escape exits placement mode cleanly without trapping focus
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(placeToggle).toHaveAttribute('aria-pressed', 'false');
      expect(liveRegion?.textContent).toMatch(/Placement mode exited for Gala Round 50/i);
    });

    it('protects occupied seats from accidental single-click removal, confirms Enter/Space via alertdialog, and removes directly on Delete or double-click', async () => {
      const onSelectTable = jest.fn();
      const onUnassignGuest = jest.fn();
      const tableWithOccupiedSeat: SeatingTableDTO = {
        id: 'tbl-occ',
        name: 'Orchard 1',
        shape: 'round',
        capacity: 4,
        x: 120,
        y: 120,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'g-occ-1',
            guestName: 'River Song',
            code: 'RS01',
            tableId: 'tbl-occ',
            seatNumber: 1,
            used: true,
            isSample: false,
            partyTags: [],
            plusOneAllocations: 0,
            extraFields: { attending: true },
          } as InvitationCodeDTO,
        ],
      };

      render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[tableWithOccupiedSeat]}
          onSelectTable={onSelectTable}
          onUnassignGuest={onUnassignGuest}
        />
      );

      const occupiedSeat = screen.getByRole('button', { name: 'Seat 1: River Song' });

      // Single click selects table without unassigning guest
      fireEvent.click(occupiedSeat);
      expect(onSelectTable).toHaveBeenCalledWith('tbl-occ');
      expect(onUnassignGuest).not.toHaveBeenCalled();

      // Enter key opens accessible confirmation alertdialog before unassigning
      fireEvent.keyDown(occupiedSeat, { key: 'Enter' });
      const confirmDialog = await screen.findByRole('alertdialog');
      expect(confirmDialog).toHaveTextContent(/Remove River Song from Orchard 1 \(Seat 1\)\?/i);
      expect(onUnassignGuest).not.toHaveBeenCalled();

      // Cancel preserves seat assignment
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
      expect(onUnassignGuest).not.toHaveBeenCalled();

      // Space key opens confirmation alertdialog and Confirm unassigns
      fireEvent.keyDown(occupiedSeat, { key: ' ' });
      await screen.findByRole('alertdialog');
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => {
        expect(onUnassignGuest).toHaveBeenCalledWith('g-occ-1');
      });

      // Delete key unassigns directly without confirmation prompt
      onUnassignGuest.mockClear();
      fireEvent.keyDown(occupiedSeat, { key: 'Delete' });
      expect(onUnassignGuest).toHaveBeenCalledWith('g-occ-1');

      // Double click unassigns directly
      onUnassignGuest.mockClear();
      fireEvent.doubleClick(occupiedSeat);
      expect(onUnassignGuest).toHaveBeenCalledWith('g-occ-1');
    });

    it('uses solid hex dimmed seat CSS variables without opacity-60 during search and passes jest-axe including label-content-name-mismatch', async () => {
      const { axe } = await import('jest-axe');
      const searchTable: SeatingTableDTO = {
        id: 'tbl-search',
        name: 'Rose Table',
        shape: 'round',
        capacity: 4,
        x: 160,
        y: 160,
        width: 120,
        height: 120,
        rotation: 30,
        isSample: false,
        invitationCodes: [
          {
            id: 'g-match',
            guestName: 'Martha Jones',
            code: 'MJ01',
            tableId: 'tbl-search',
            seatNumber: 1,
            used: true,
            isSample: false,
            partyTags: [],
            plusOneAllocations: 0,
            extraFields: { attending: true },
          } as InvitationCodeDTO,
          {
            id: 'g-dimmed',
            guestName: 'Donna Noble',
            code: 'DN02',
            tableId: 'tbl-search',
            seatNumber: 2,
            used: true,
            isSample: false,
            partyTags: [],
            plusOneAllocations: 0,
            extraFields: { attending: true },
          } as InvitationCodeDTO,
        ],
      };

      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[searchTable]}
          guests={searchTable.invitationCodes || []}
          selectedTableId="tbl-search"
          searchQuery="Martha"
        />
      );

      const dimmedAssigned = screen.getByRole('button', { name: 'Seat 2: Donna Noble' });
      const dimmedEmpty = screen.getByRole('button', { name: 'Rose Table, Seat 3: Empty' });
      expect(dimmedAssigned.className).not.toContain('opacity-60');
      expect(dimmedEmpty.className).not.toContain('opacity-60');
      expect(dimmedAssigned.style.backgroundColor).toContain('--floorplan-seat-dimmed-bg');
      expect(dimmedAssigned.style.color).toContain('--floorplan-seat-dimmed-text');

      const results = await axe(container, {
        rules: {
          'label-content-name-mismatch': { enabled: true },
        },
      });
      expect(results.violations).toEqual([]);
    });

    it('renders empty floorplan heading as h2 by default and supports emptyHeadingLevel override', () => {
      const { rerender } = render(<FloorplanCanvas {...defaultProps} tables={[]} />);
      expect(
        screen.getByRole('heading', { level: 2, name: 'No Tables Created Yet' })
      ).toBeInTheDocument();

      rerender(<FloorplanCanvas {...defaultProps} tables={[]} emptyHeadingLevel="h3" />);
      expect(
        screen.getByRole('heading', { level: 3, name: 'No Tables Created Yet' })
      ).toBeInTheDocument();
    });
  });

  describe('Per-table memoization and geometry bounds during 50-table gestures', () => {
    const buildFiftyTables = (): SeatingTableDTO[] =>
      Array.from({ length: 50 }, (_, index) => {
        const tableNumber = index + 1;
        const tableId = `table-${tableNumber}`;
        return {
          id: tableId,
          name: `Table ${tableNumber}`,
          shape: index % 2 === 0 ? 'round' : 'rectangular',
          capacity: 8,
          x: 80 + (index % 10) * 180,
          y: 80 + Math.floor(index / 10) * 180,
          width: 120,
          height: 120,
          rotation: 0,
          isSample: false,
          invitationCodes: [
            {
              id: `guest-${tableNumber}-a`,
              code: `CODE-${tableNumber}-A`,
              guestName: `Guest ${tableNumber}A`,
              tableId,
              seatNumber: 1,
              used: true,
              isSample: false,
              plusOneAllocations: 0,
              partyTags: [],
              dietaryNotes: 'Vegan',
              extraFields: { attending: true },
            } as InvitationCodeDTO,
            {
              id: `guest-${tableNumber}-b`,
              code: `CODE-${tableNumber}-B`,
              guestName: `Guest ${tableNumber}B`,
              tableId,
              seatNumber: 2,
              used: true,
              isSample: false,
              plusOneAllocations: 0,
              partyTags: [],
              dietaryNotes: 'Gluten-Free',
              extraFields: { attending: true },
            } as InvitationCodeDTO,
          ],
        };
      });

    it('executes resolveDetailedSeatAssignments and matchDietaryCategory 0 times across all 50 tables during pointer drag and rotation frames', () => {
      const fiftyTables = buildFiftyTables();
      const onUpdateTablePosition = jest.fn();
      const onUpdateTableRotation = jest.fn();
      let commitCount = 0;

      const { container } = render(
        <Profiler
          id="floorplan-50"
          onRender={() => {
            commitCount += 1;
          }}
        >
          <FloorplanCanvas
            {...defaultProps}
            tables={fiftyTables}
            selectedTableId="table-1"
            onUpdateTablePosition={onUpdateTablePosition}
            onUpdateTableRotation={onUpdateTableRotation}
          />
        </Profiler>
      );

      const canvasElement = container.firstElementChild as HTMLElement;
      jest.spyOn(canvasElement, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 2200,
        bottom: 1400,
        width: 2200,
        height: 1400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const resolveSeatsSpy = resolveDetailedSeatAssignments as jest.Mock;
      const matchDietarySpy = matchDietaryCategory as jest.Mock;
      const computeSeatPosSpy = computeSeatPosition as jest.Mock;

      expect(resolveSeatsSpy).toHaveBeenCalledTimes(50);
      expect(matchDietarySpy.mock.calls.length).toBeGreaterThan(0);

      resolveSeatsSpy.mockClear();
      matchDietarySpy.mockClear();
      computeSeatPosSpy.mockClear();
      commitCount = 0;

      const activeTable = screen.getByRole('button', { name: /^Table 1, shape/i });
      const staticTable = screen.getByRole('button', { name: /^Table 50, shape/i });
      const staticLeftBefore = staticTable.style.left;
      const staticTopBefore = staticTable.style.top;

      fireEvent.mouseDown(activeTable, { button: 0, clientX: 100, clientY: 100 });
      for (let frame = 1; frame <= 20; frame++) {
        fireEvent.mouseMove(canvasElement, {
          clientX: 100 + frame * 4,
          clientY: 100 + frame * 3,
        });
      }
      expect(activeTable.style.left).toBe('160px');
      expect(activeTable.style.top).toBe('140px');
      expect(staticTable.style.left).toBe(staticLeftBefore);
      expect(staticTable.style.top).toBe(staticTopBefore);
      expect(commitCount).toBeGreaterThanOrEqual(20);

      // Zero seat-assignment, dietary-badge, or chair-position recalculations during drag frames
      expect(resolveSeatsSpy).toHaveBeenCalledTimes(0);
      expect(matchDietarySpy).toHaveBeenCalledTimes(0);
      expect(computeSeatPosSpy).toHaveBeenCalledTimes(0);

      fireEvent.mouseUp(canvasElement);
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 160, 140);

      // Now verify rotation frames on Table 1 (round table: center at 80+60=140, 80+60=140)
      resolveSeatsSpy.mockClear();
      matchDietarySpy.mockClear();
      computeSeatPosSpy.mockClear();

      const rotateHandle = screen.getByRole('button', { name: /Rotate handle for Table 1/i });
      fireEvent.mouseDown(rotateHandle, { button: 0, clientX: 140, clientY: 60 });
      for (let step = 1; step <= 12; step++) {
        const angleRad = ((step * 15 - 90) * Math.PI) / 180;
        fireEvent.mouseMove(canvasElement, {
          clientX: 140 + Math.cos(angleRad) * 80,
          clientY: 140 + Math.sin(angleRad) * 80,
        });
      }
      expect(resolveSeatsSpy).toHaveBeenCalledTimes(0);
      expect(matchDietarySpy).toHaveBeenCalledTimes(0);
      // Static 49 tables execute 0 chair recalculations; Table 1 only recomputes chair layout on axis-alignment flips + minBounds
      expect(computeSeatPosSpy.mock.calls.length).toBeLessThanOrEqual(12 * 8 + 4 * 8);

      fireEvent.mouseUp(canvasElement);
      expect(onUpdateTableRotation).toHaveBeenCalledTimes(1);
    });

    it('recomputes rectangular/square scaled bounds synchronously during rotation drag when renderedRotation % 90 === 0 flips', () => {
      const squareTwoPerSide: SeatingTableDTO = {
        id: 'tbl-axis-flip',
        name: 'Axis Flip Table',
        shape: 'square',
        capacity: 8,
        x: 200,
        y: 200,
        width: 100,
        height: 100,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      };

      const { container } = render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[squareTwoPerSide]}
          selectedTableId="tbl-axis-flip"
        />
      );

      const canvasElement = container.firstElementChild as HTMLElement;
      jest.spyOn(canvasElement, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 800,
        bottom: 650,
        width: 800,
        height: 650,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const tableNode = screen.getByRole('button', { name: /^Axis Flip Table, shape square/i });
      // At 0° (axis-aligned), 100px >= 33 * 3 = 99px, so width/height stay 100px
      expect(tableNode.style.width).toBe('100px');
      expect(tableNode.style.height).toBe('100px');

      const handleBtn = screen.getByRole('button', { name: /Rotate handle for Axis Flip Table/i });
      fireEvent.mouseDown(handleBtn, { button: 0, clientX: 250, clientY: 140 });

      // Drag handle to 45° diagonal (center is 250, 250 -> dx=60, dy=-60 -> clientX=310, clientY=190)
      fireEvent.mouseMove(canvasElement, { clientX: 310, clientY: 190 });
      expect(tableNode.style.transform).toBe('rotate(45deg)');
      // Off-axis diagonal clearance scales 2-seat square edges to 36 * 3 = 108px
      expect(tableNode.style.width).toBe('108px');
      expect(tableNode.style.height).toBe('108px');

      // Drag handle to 90° axis-aligned (gesture center stays anchored at 250, 250 -> clientX=340, clientY=250)
      fireEvent.mouseMove(canvasElement, { clientX: 340, clientY: 250 });
      expect(tableNode.style.transform).toBe('rotate(90deg)');
      expect(tableNode.style.width).toBe('100px');
      expect(tableNode.style.height).toBe('100px');

      fireEvent.mouseUp(canvasElement);
    });
  });

  describe('Selection aria-pressed, table-prefixed empty seats, and keyboard-focusable floorplan region', () => {
    it('exposes tabIndex=0 on scrollable floorplan region, aria-pressed on tables and landmarks, and table-prefixed empty seats', async () => {
      const landmark: SeatingTableDTO = {
        id: 'landmark-dance',
        name: 'Main Dance Floor',
        shape: 'dance-floor',
        capacity: 0,
        x: 420,
        y: 120,
        width: 180,
        height: 180,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      };
      const secondTable: SeatingTableDTO = {
        id: 'table-empty-2',
        name: 'Garden Table',
        shape: 'round',
        capacity: 2,
        x: 260,
        y: 260,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      };

      const { container, rerender } = render(
        <FloorplanCanvas
          {...defaultProps}
          tables={[mockTables[0], secondTable, landmark]}
          selectedTableId="table-1"
        />
      );

      const region = screen.getByRole('region', {
        name: 'Interactive 2D Reception Floorplan Canvas',
      });
      expect(region).toHaveAttribute('tabIndex', '0');

      const headTableBtn = screen.getByRole('button', { name: /^Head Table, shape rectangular/i });
      const gardenTableBtn = screen.getByRole('button', { name: /^Garden Table, shape round/i });
      const landmarkBtn = screen.getByRole('button', { name: /^Main Dance Floor, landmark/i });

      expect(headTableBtn).toHaveAttribute('aria-pressed', 'true');
      expect(gardenTableBtn).toHaveAttribute('aria-pressed', 'false');
      expect(landmarkBtn).toHaveAttribute('aria-pressed', 'false');

      // Empty seats across multiple tables have unique table-prefixed accessible names
      expect(screen.getByRole('button', { name: 'Head Table, Seat 2: Empty' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Garden Table, Seat 1: Empty' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Garden Table, Seat 2: Empty' })
      ).toBeInTheDocument();

      rerender(
        <FloorplanCanvas
          {...defaultProps}
          tables={[mockTables[0], secondTable, landmark]}
          selectedTableId="landmark-dance"
        />
      );
      expect(headTableBtn).toHaveAttribute('aria-pressed', 'false');
      expect(landmarkBtn).toHaveAttribute('aria-pressed', 'true');

      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

