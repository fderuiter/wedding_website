import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SiteManagerPage from '../page';

// Mock next/dynamic to load DragDropContainer synchronously in test environment
jest.mock('next/dynamic', () => {
  return {
    __esModule: true,
    default: () => {
      const DragDropContainer = require('../components/DragDropContainer').default;
      return function MockDynamic(props: any) {
        return <DragDropContainer {...props} />;
      };
    },
  };
});

// Mock @hello-pangea/dnd to render simply and support triggering onDragEnd
jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children, onDragEnd }: any) => (
    <div
      data-testid="drag-drop-context"
      onClick={() => onDragEnd({ destination: { index: 1 }, source: { index: 0 } })}
    >
      {children}
    </div>
  ),
  Droppable: ({ children }: any) =>
    children({
      droppableProps: { 'data-testid': 'droppable' },
      innerRef: React.createRef(),
      placeholder: <div data-testid="placeholder" />,
    }),
  Draggable: ({ children }: any) =>
    children({
      draggableProps: { 'data-testid': 'draggable' },
      dragHandleProps: { 'data-testid': 'drag-handle' },
      innerRef: React.createRef(),
    }),
}));

const mockFeatures = [
  { id: 'story', type: 'story', title: 'Our Story', visible: true },
  { id: 'details', type: 'details', title: 'Wedding Day Details', visible: false },
];

const mockSaveFeatures = jest.fn().mockResolvedValue(true);
const mockAddToast = jest.fn();

jest.mock('@/hooks/admin/useAdminFeatures', () => ({
  useAdminFeatures: () => ({
    features: mockFeatures,
    loading: false,
    error: null,
    saveFeatures: mockSaveFeatures,
  }),
}));

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

describe('SiteManagerPage and DragDropContainer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the site manager layout and title', () => {
    render(<SiteManagerPage />);
    expect(screen.getByText('Visual Site Manager')).toBeInTheDocument();
    expect(screen.getByText('Our Story')).toBeInTheDocument();
    expect(screen.getByText('Wedding Day Details')).toBeInTheDocument();
  });

  it('correctly stops propagation on the Visibility button, preventing accidental drag', () => {
    const parentClickSpy = jest.fn();
    const mockToggleVisibility = jest.fn();
    const DragDropContainer = require('../components/DragDropContainer').default;

    render(
      <div onClick={parentClickSpy}>
        <DragDropContainer
          features={mockFeatures}
          saveFeatures={mockSaveFeatures}
          toggleVisibility={mockToggleVisibility}
        />
      </div>
    );

    const visibleBtn = screen.getByRole('button', { name: 'Visible' });
    fireEvent.click(visibleBtn);

    // parent onClick spy should NOT have been called due to e.stopPropagation()
    expect(parentClickSpy).not.toHaveBeenCalled();
    // But toggleVisibility should have been called
    expect(mockToggleVisibility).toHaveBeenCalledWith('story');
  });

  it('fires sequence mutation payload immediately when a drop action completes', async () => {
    render(<SiteManagerPage />);

    // Clicking the drag drop context triggers the mock onDragEnd callback (from index 0 to 1)
    const context = screen.getByTestId('drag-drop-context');
    fireEvent.click(context);

    // Assert saveFeatures was called with the reordered array
    expect(mockSaveFeatures).toHaveBeenCalledWith([
      { id: 'details', type: 'details', title: 'Wedding Day Details', visible: false },
      { id: 'story', type: 'story', title: 'Our Story', visible: true },
    ]);
  });

  it('disables Move Up on the first item and Move Down on the last item', () => {
    render(<SiteManagerPage />);

    const moveUpStoryBtn = screen.getByRole('button', { name: 'Move Our Story up' });
    const moveDownStoryBtn = screen.getByRole('button', { name: 'Move Our Story down' });

    const moveUpDetailsBtn = screen.getByRole('button', { name: 'Move Wedding Day Details up' });
    const moveDownDetailsBtn = screen.getByRole('button', { name: 'Move Wedding Day Details down' });

    expect(moveUpStoryBtn).toBeDisabled();
    expect(moveDownStoryBtn).not.toBeDisabled();

    expect(moveUpDetailsBtn).not.toBeDisabled();
    expect(moveDownDetailsBtn).toBeDisabled();
  });

  it('reorders features and announces position updates via ARIA live region when Move Down is clicked', () => {
    render(<SiteManagerPage />);

    const moveDownStoryBtn = screen.getByRole('button', { name: 'Move Our Story down' });
    fireEvent.click(moveDownStoryBtn);

    expect(mockSaveFeatures).toHaveBeenCalledWith([
      { id: 'details', type: 'details', title: 'Wedding Day Details', visible: false },
      { id: 'story', type: 'story', title: 'Our Story', visible: true },
    ]);

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveTextContent('Moved Our Story down to position 2 of 2');
  });

  it('reorders features and announces position updates via ARIA live region when Move Up is clicked', () => {
    render(<SiteManagerPage />);

    const moveUpDetailsBtn = screen.getByRole('button', { name: 'Move Wedding Day Details up' });
    fireEvent.click(moveUpDetailsBtn);

    expect(mockSaveFeatures).toHaveBeenCalledWith([
      { id: 'details', type: 'details', title: 'Wedding Day Details', visible: false },
      { id: 'story', type: 'story', title: 'Our Story', visible: true },
    ]);

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveTextContent('Moved Wedding Day Details up to position 1 of 2');
  });
});
