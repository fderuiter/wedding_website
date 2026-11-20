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

  it('allows creating, reordering, editing, and deleting meal options and custom questions and passes jest-axe', async () => {
    const onSave = jest.fn().mockResolvedValue({});

    const { baseElement } = render(
      <ToastProvider>
        <SubEventEditorModal
          isOpen={true}
          onClose={jest.fn()}
          editingEvent={sampleEvents[0]}
          onSave={onSave}
        />
      </ToastProvider>
    );

    // Add two meal options
    fireEvent.click(screen.getByRole('button', { name: '+ Add Meal Option' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add Meal Option' }));

    const mealNameInputs = screen.getAllByLabelText('Entrée Name *');
    expect(mealNameInputs).toHaveLength(2);
    fireEvent.change(mealNameInputs[0], { target: { value: 'Herb-Crusted Salmon' } });
    fireEvent.change(mealNameInputs[1], { target: { value: 'Truffle Gnocchi' } });

    // Toggle gluten-free on first meal option
    const row0 = screen.getByTestId('meal-option-row-0');
    const gfCheckbox = row0.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(gfCheckbox);

    // Reorder second meal option up so Truffle Gnocchi becomes #1
    fireEvent.click(screen.getByRole('button', { name: 'Move meal option Truffle Gnocchi up' }));
    const reorderedInputs = screen.getAllByLabelText('Entrée Name *') as HTMLInputElement[];
    expect(reorderedInputs[0].value).toBe('Truffle Gnocchi');
    expect(reorderedInputs[1].value).toBe('Herb-Crusted Salmon');

    // Add a third meal option and remove it
    fireEvent.click(screen.getByRole('button', { name: '+ Add Meal Option' }));
    expect(screen.getAllByLabelText('Entrée Name *')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Remove meal option #3' }));
    expect(screen.getAllByLabelText('Entrée Name *')).toHaveLength(2);

    // Add two custom RSVP questions (choice + text)
    fireEvent.click(screen.getByRole('button', { name: '+ Add Question' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add Question' }));

    const promptInputs = screen.getAllByLabelText('Question Prompt *');
    fireEvent.change(promptInputs[0], { target: { value: 'Song request' } });
    fireEvent.change(promptInputs[1], { target: { value: 'Will you ride the shuttle?' } });

    const typeSelects = screen.getAllByLabelText('Response Type');
    fireEvent.change(typeSelects[1], { target: { value: 'choice' } });

    const requiredCheckboxes = screen.getAllByLabelText('Required for attending guests');
    fireEvent.click(requiredCheckboxes[1]);

    fireEvent.change(screen.getByLabelText('Question 2 choice 1'), {
      target: { value: 'Yes, round-trip' },
    });
    fireEvent.change(screen.getByLabelText('Question 2 choice 2'), {
      target: { value: 'No, driving' },
    });

    // Reorder shuttle question up
    fireEvent.click(
      screen.getByRole('button', { name: 'Move question Will you ride the shuttle? up' })
    );

    // Verify zero WCAG violations with populated meal options and choice questions
    const axeResults = await axe(baseElement);
    expect(axeResults).toHaveNoViolations();

    // Save changes
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const savedPayload = onSave.mock.calls[0][0];
    expect(savedPayload.mealOptions).toHaveLength(2);
    expect(savedPayload.mealOptions[0].label).toBe('Truffle Gnocchi');
    expect(savedPayload.mealOptions[1]).toMatchObject({
      label: 'Herb-Crusted Salmon',
      dietaryTags: ['gluten-free'],
    });
    expect(savedPayload.customQuestions).toHaveLength(2);
    expect(savedPayload.customQuestions[0]).toMatchObject({
      prompt: 'Will you ride the shuttle?',
      type: 'choice',
      required: true,
      options: ['Yes, round-trip', 'No, driving'],
    });
    expect(savedPayload.customQuestions[1]).toMatchObject({
      prompt: 'Song request',
      type: 'text',
      required: false,
      options: [],
    });
  }, 15000);
});
