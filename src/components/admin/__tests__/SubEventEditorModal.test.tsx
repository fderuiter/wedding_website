import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { ToastProvider } from '@/components/ui/ToastProvider';
import {
  SubEventEditorModal,
  SubEventDeleteConfirmModal,
  type EditableSubEvent,
} from '../SubEventEditorModal';

const sampleEvents: EditableSubEvent[] = [
  {
    id: 'se-1',
    title: 'Rehearsal Dinner',
    description: 'Wedding party dinner',
    startTime: '2026-09-18T18:00:00.000Z',
    endTime: '2026-09-18T21:00:00.000Z',
    locationName: 'Grand Ballroom',
    category: 'Dining',
    isPrivate: true,
  },
];

describe('SubEventEditorModal & SubEventDeleteConfirmModal', () => {
  it('passes automated jest-axe accessibility checks in edit mode with existing events list', async () => {
    const { baseElement } = render(
      <ToastProvider>
        <SubEventEditorModal
          isOpen={true}
          onClose={jest.fn()}
          editingEvent={sampleEvents[0]}
          existingSubEvents={sampleEvents}
          onSelectEdit={jest.fn()}
          onRequestDelete={jest.fn()}
          onSave={jest.fn().mockResolvedValue({})}
        />
      </ToastProvider>
    );

    expect(screen.getByRole('dialog', { name: 'Edit Sub-Event' })).toBeInTheDocument();
    const results = await axe(baseElement);
    expect(results).toHaveNoViolations();
  });

  it('switches cleanly from edit mode back to create mode via onSelectEdit(null)', () => {
    const onSelectEdit = jest.fn();

    render(
      <ToastProvider>
        <SubEventEditorModal
          isOpen={true}
          onClose={jest.fn()}
          editingEvent={sampleEvents[0]}
          existingSubEvents={sampleEvents}
          onSelectEdit={onSelectEdit}
          onSave={jest.fn().mockResolvedValue({})}
        />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Switch to Create New' }));
    expect(onSelectEdit).toHaveBeenCalledWith(null);
  });

  it('passes automated jest-axe accessibility checks on SubEventDeleteConfirmModal and keeps dialog open on error', async () => {
    const onConfirm = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce({});
    const onClose = jest.fn();

    const { baseElement } = render(
      <SubEventDeleteConfirmModal
        subEvent={sampleEvents[0]}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole('alertdialog', { name: 'Delete Sub-Event' })).toBeInTheDocument();
    const results = await axe(baseElement);
    expect(results).toHaveNoViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Sub-Event' }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Sub-Event' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('guards dirty modal dismissal and dirty sub-event switching with ToastProvider.confirm', async () => {
    const onClose = jest.fn();
    const onSelectEdit = jest.fn();

    render(
      <ToastProvider>
        <SubEventEditorModal
          isOpen={true}
          onClose={onClose}
          editingEvent={sampleEvents[0]}
          existingSubEvents={sampleEvents}
          onSelectEdit={onSelectEdit}
          onSave={jest.fn().mockResolvedValue({})}
        />
      </ToastProvider>
    );

    const titleInput = screen.getByLabelText(/Title \*/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Updated Rehearsal Dinner' } });

    // Switching to Create New while dirty prompts first
    fireEvent.click(screen.getByRole('button', { name: '+ Switch to Create New' }));
    const switchAlert = await screen.findByRole('alertdialog');
    expect(onSelectEdit).not.toHaveBeenCalled();

    // Cancel keeps unsaved edit
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Cancel' }).find((btn) => switchAlert.contains(btn))!
    );
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(titleInput.value).toBe('Updated Rehearsal Dinner');
    expect(onSelectEdit).not.toHaveBeenCalled();

    // Escape on dirty modal prompts; confirming closes
    fireEvent.keyDown(document, { key: 'Escape' });
    await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
