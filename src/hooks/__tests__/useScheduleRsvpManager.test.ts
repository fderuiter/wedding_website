import { renderHook, act } from '@testing-library/react';
import { useScheduleRsvpManager, type EventRsvpFiniteState } from '../useScheduleRsvpManager';

describe('useScheduleRsvpManager', () => {
  const sampleEvents = [
    {
      id: 'event-1',
      title: 'Ceremony',
      userRsvp: {
        status: 'pending' as const,
        plusOneCount: 0,
        dietaryNotes: '',
      },
    },
    {
      id: 'event-2',
      title: 'Reception',
      userRsvp: {
        status: 'attending' as const,
        plusOneCount: 1,
        dietaryNotes: 'Vegetarian',
      },
    },
  ];

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('initializes finite state machines and baselines accurately', () => {
    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    const event1 = result.current.getRsvpState('event-1');
    const expectedIdle: EventRsvpFiniteState = 'idle';
    expect(event1.state).toBe(expectedIdle);
    expect(event1.isDirty).toBe(false);
    expect(event1.current.status).toBe('pending');
    expect(event1.baseline.status).toBe('pending');

    const event2 = result.current.getRsvpState('event-2');
    expect(event2.state).toBe('idle');
    expect(event2.isDirty).toBe(false);
    expect(event2.current.status).toBe('attending');
    expect(event2.current.plusOneCount).toBe(1);
    expect(event2.current.dietaryNotes).toBe('Vegetarian');

    expect(result.current.dirtyCount).toBe(0);
    expect(result.current.isDirty).toBe(false);
  });

  it('transitions state to dirty when user updates attendance or notes, and clears prior banners', () => {
    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending' });
    });

    const event1 = result.current.getRsvpState('event-1');
    expect(event1.state).toBe('dirty');
    expect(event1.isDirty).toBe(true);
    expect(event1.current.status).toBe('attending');
    expect(result.current.dirtyCount).toBe(1);
    expect(result.current.dirtyEventIds).toEqual(['event-1']);

    // Changing it back to baseline restores idle state
    act(() => {
      result.current.updateRsvp('event-1', { status: 'pending' });
    });
    expect(result.current.getRsvpState('event-1').state).toBe('idle');
    expect(result.current.getRsvpState('event-1').isDirty).toBe(false);
    expect(result.current.dirtyCount).toBe(0);
  });

  it('submits single event and synchronizes baseline state upon success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'rsvp-1',
            subEventId: 'event-1',
            status: 'attending',
            plusOneCount: 2,
            dietaryNotes: 'No nuts',
          },
        ],
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    act(() => {
      result.current.updateRsvp('event-1', {
        status: 'attending',
        plusOneCount: 2,
        dietaryNotes: 'No nuts',
      });
    });

    let success = false;
    await act(async () => {
      success = await result.current.submitSingle('event-1');
    });

    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subEventId: 'event-1',
        status: 'attending',
        plusOneCount: 2,
        dietaryNotes: 'No nuts',
      }),
    });

    const event1 = result.current.getRsvpState('event-1');
    expect(event1.state).toBe('success');
    expect(event1.isDirty).toBe(false);
    expect(event1.baseline.status).toBe('attending');
    expect(event1.baseline.plusOneCount).toBe(2);
    expect(event1.baseline.dietaryNotes).toBe('No nuts');
    expect(event1.message).toBe('RSVP submitted successfully!');
    expect(result.current.liveMessage).toBe('Successfully saved RSVP.');
  });

  it('dispatches batch submissions conforming to SubEventRsvpBatchSubmissionSchema', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'rsvp-1',
            subEventId: 'event-1',
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: '',
          },
          {
            id: 'rsvp-2',
            subEventId: 'event-2',
            status: 'declined',
            plusOneCount: 0,
            dietaryNotes: '',
          },
        ],
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending' });
      result.current.updateRsvp('event-2', { status: 'declined', plusOneCount: 0, dietaryNotes: '' });
    });

    expect(result.current.dirtyCount).toBe(2);

    let success = false;
    await act(async () => {
      success = await result.current.submitBatch();
    });

    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rsvps: [
          {
            subEventId: 'event-1',
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: '',
          },
          {
            subEventId: 'event-2',
            status: 'declined',
            plusOneCount: 0,
            dietaryNotes: '',
          },
        ],
      }),
    });

    expect(result.current.dirtyCount).toBe(0);
    expect(result.current.getRsvpState('event-1').state).toBe('success');
    expect(result.current.getRsvpState('event-2').state).toBe('success');
    expect(result.current.liveMessage).toBe('Successfully saved RSVPs for 2 events.');
  });

  it('rolls back to error state and preserves user edits on batch failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: 'Network timeout occurred.',
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending', dietaryNotes: 'Halal' });
    });

    let success = false;
    await act(async () => {
      success = await result.current.submitBatch();
    });

    expect(success).toBe(false);
    expect(result.current.batchError).toBe('Network timeout occurred.');
    expect(result.current.liveMessage).toContain('Network timeout occurred.');

    const event1 = result.current.getRsvpState('event-1');
    expect(event1.state).toBe('error');
    expect(event1.error).toBe('Network timeout occurred.');
    // User pending edits are preserved
    expect(event1.current.status).toBe('attending');
    expect(event1.current.dietaryNotes).toBe('Halal');
    expect(event1.isDirty).toBe(true);
  });

  it('clears stale error and success messages when user makes a modification', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ id: 'rsvp-1', subEventId: 'event-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' }],
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending' });
    });

    await act(async () => {
      await result.current.submitSingle('event-1');
    });

    expect(result.current.getRsvpState('event-1').message).toBe('RSVP submitted successfully!');

    // User modifies note: stale message should immediately be cleared
    act(() => {
      result.current.updateRsvp('event-1', { dietaryNotes: 'Vegan only' });
    });

    const updated = result.current.getRsvpState('event-1');
    expect(updated.message).toBeNull();
    expect(updated.error).toBeNull();
    expect(updated.state).toBe('dirty');
  });

  it('excludes read-only fallback events from RSVP tracking', () => {
    const { result } = renderHook(() =>
      useScheduleRsvpManager({
        initialEvents: [
          { id: 'cn-readonly', title: 'Read Only Event', isReadOnly: true, userRsvp: null },
          { id: 'se-live', title: 'Live Event', isReadOnly: false, userRsvp: null },
        ],
      })
    );

    expect(result.current.eventsMap['cn-readonly']).toBeUndefined();
    expect(result.current.eventsMap['se-live']).toBeDefined();
  });

  it('clamps plus-one updates to 0 when maxPlusOnes is 0', () => {
    const { result } = renderHook(() =>
      useScheduleRsvpManager({
        initialEvents: sampleEvents,
        maxPlusOnes: 0,
      })
    );

    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending', plusOneCount: 2 });
    });

    expect(result.current.getRsvpState('event-1').current.plusOneCount).toBe(0);
  });

  it('allows plus-ones up to positive maxPlusOnes and blocks submitSingle / submitBatch above limit', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ id: 'r1', subEventId: 'event-1', status: 'attending', plusOneCount: 2, dietaryNotes: '' }],
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({
        initialEvents: sampleEvents,
        maxPlusOnes: 2,
      })
    );

    // Valid submission at exact cap (2)
    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending', plusOneCount: 2 });
    });

    let ok = false;
    await act(async () => {
      ok = await result.current.submitSingle('event-1');
    });
    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Exceeding cap (3) surfaces error and preserves unsaved input without hitting network
    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending', plusOneCount: 3 });
    });

    let blockedSingle = true;
    await act(async () => {
      blockedSingle = await result.current.submitSingle('event-1');
    });
    expect(blockedSingle).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.getRsvpState('event-1').error).toBe(
      'Plus-one count (3) exceeds your allocated limit of 2.'
    );
    expect(result.current.getRsvpState('event-1').current.plusOneCount).toBe(3);

    let blockedBatch = true;
    await act(async () => {
      blockedBatch = await result.current.submitBatch();
    });
    expect(blockedBatch).toBe(false);
    expect(result.current.batchError).toBe(
      'Plus-one count (3) exceeds your allocated limit of 2.'
    );
  });

  it('resets plusOneCount to 0 when declining even if maxPlusOnes was lowered below baseline plusOneCount', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ id: 'r2', subEventId: 'event-2', status: 'declined', plusOneCount: 0, dietaryNotes: 'Vegetarian' }],
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({
        initialEvents: [
          {
            id: 'event-2',
            title: 'Reception',
            userRsvp: { status: 'attending', plusOneCount: 2, dietaryNotes: 'Vegetarian' },
          },
        ],
        maxPlusOnes: 0,
      })
    );

    act(() => {
      result.current.updateRsvp('event-2', { status: 'declined' });
    });

    expect(result.current.getRsvpState('event-2').current.plusOneCount).toBe(0);

    let ok = false;
    await act(async () => {
      ok = await result.current.submitSingle('event-2');
    });

    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subEventId: 'event-2',
        status: 'declined',
        plusOneCount: 0,
        dietaryNotes: 'Vegetarian',
      }),
    });
  });

  it('surfaces HTTP 403 closing message in polite liveMessage and invokes onRsvpClosed when cutoff expires while page stays open', async () => {
    const onRsvpClosed = jest.fn();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          success: false,
          error: 'Online RSVPs closed at midnight. Please email couple@example.com.',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          success: false,
          error: 'Online RSVPs closed at midnight. Please email couple@example.com.',
        }),
      });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents, onRsvpClosed })
    );

    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending' });
    });

    let singleOk = true;
    await act(async () => {
      singleOk = await result.current.submitSingle('event-1');
    });

    expect(singleOk).toBe(false);
    expect(result.current.liveMessage).toBe(
      'Online RSVPs closed at midnight. Please email couple@example.com.'
    );
    expect(onRsvpClosed).toHaveBeenCalledWith(
      'Online RSVPs closed at midnight. Please email couple@example.com.'
    );

    let batchOk = true;
    await act(async () => {
      batchOk = await result.current.submitBatch();
    });

    expect(batchOk).toBe(false);
    expect(result.current.liveMessage).toBe(
      'Online RSVPs closed at midnight. Please email couple@example.com.'
    );
    expect(onRsvpClosed).toHaveBeenCalledTimes(2);
  });

  it('blocks submitSingle and submitBatch when attending guests omit required meal selections or required custom prompts, and clears them on declined', async () => {
    const dinnerEvents = [
      {
        id: 'event-dinner',
        title: 'Evening Reception',
        mealOptions: [
          { id: 'm-salmon', label: 'Herb Salmon', dietaryTags: ['gluten-free'] },
          { id: 'm-beef', label: 'Braised Beef', dietaryTags: [] },
        ],
        customQuestions: [
          {
            id: 'q-shuttle',
            prompt: 'Will you take the hotel shuttle?',
            type: 'choice' as const,
            required: true,
            options: ['Yes', 'No'],
          },
        ],
        userRsvp: {
          status: 'pending' as const,
          plusOneCount: 0,
          dietaryNotes: '',
        },
      },
    ];

    const { result } = renderHook(() =>
      useScheduleRsvpManager({
        initialEvents: dinnerEvents,
        maxPlusOnes: 2,
        defaultPlusOneNames: ['Jordan Taylor'],
      })
    );

    act(() => {
      result.current.updateRsvp('event-dinner', { status: 'attending', plusOneCount: 1 });
    });

    expect(result.current.getRsvpState('event-dinner').current.plusOneNames).toEqual([
      'Jordan Taylor',
    ]);

    let singleOk = true;
    await act(async () => {
      singleOk = await result.current.submitSingle('event-dinner');
    });
    expect(singleOk).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.getRsvpState('event-dinner').error).toBe(
      'Please select an entrée option for all 2 attending guests.'
    );

    act(() => {
      result.current.updateRsvp('event-dinner', {
        mealSelections: ['m-salmon', 'm-beef'],
      });
    });

    let batchOk = true;
    await act(async () => {
      batchOk = await result.current.submitBatch();
    });
    expect(batchOk).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.batchError).toBe(
      'Please answer required question: "Will you take the hotel shuttle?".'
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            subEventId: 'event-dinner',
            status: 'attending',
            plusOneCount: 1,
            dietaryNotes: '',
            mealSelections: ['m-salmon', 'm-beef'],
            customAnswers: { 'q-shuttle': 'Yes' },
            plusOneNames: ['Jordan Taylor'],
          },
        ],
      }),
    });

    act(() => {
      result.current.updateRsvp('event-dinner', {
        customAnswers: { 'q-shuttle': 'Yes' },
      });
    });

    await act(async () => {
      singleOk = await result.current.submitSingle('event-dinner');
    });
    expect(singleOk).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subEventId: 'event-dinner',
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: '',
        mealSelections: ['m-salmon', 'm-beef'],
        customAnswers: { 'q-shuttle': 'Yes' },
        plusOneNames: ['Jordan Taylor'],
      }),
    });

    act(() => {
      result.current.updateRsvp('event-dinner', { status: 'declined' });
    });
    const declinedState = result.current.getRsvpState('event-dinner').current;
    expect(declinedState.plusOneCount).toBe(0);
    expect(declinedState.mealSelections).toEqual([]);
    expect(declinedState.customAnswers).toEqual({});
    expect(declinedState.plusOneNames).toEqual([]);
  });

  it('rejects submitSingle and submitBatch when status remains pending', async () => {
    const { result } = renderHook(() =>
      useScheduleRsvpManager({
        initialEvents: [
          {
            id: 'event-pending',
            title: 'Ceremony',
            userRsvp: { status: 'pending', plusOneCount: 0, dietaryNotes: '' },
          },
        ],
      })
    );

    act(() => {
      result.current.updateRsvp('event-pending', { dietaryNotes: 'Gluten-free' });
    });

    let singleOk = true;
    await act(async () => {
      singleOk = await result.current.submitSingle('event-pending');
    });
    expect(singleOk).toBe(false);
    expect(result.current.getRsvpState('event-pending').error).toBe(
      'Please select Attending or Declined before saving.'
    );
    expect(global.fetch).not.toHaveBeenCalled();

    let batchOk = true;
    await act(async () => {
      batchOk = await result.current.submitBatch();
    });
    expect(batchOk).toBe(false);
    expect(result.current.batchError).toBe('Please select Attending or Declined before saving.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends clearDietaryNotes: true when baseline dietary notes are intentionally cleared', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ id: 'r1', subEventId: 'event-prefill', status: 'attending', plusOneCount: 0, dietaryNotes: '' }],
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({
        initialEvents: [
          {
            id: 'event-prefill',
            title: 'Ceremony',
            userRsvp: { status: 'pending', plusOneCount: 0, dietaryNotes: 'Peanut allergy' },
          },
        ],
      })
    );

    act(() => {
      result.current.updateRsvp('event-prefill', { status: 'attending', dietaryNotes: '' });
    });

    await act(async () => {
      await result.current.submitSingle('event-prefill');
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subEventId: 'event-prefill',
        status: 'attending',
        plusOneCount: 0,
        dietaryNotes: '',
        clearDietaryNotes: true,
      }),
    });
  });
});
