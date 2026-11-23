import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import AdminPreviewLayout from '../AdminPreviewLayout';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { apiClient } from '@/features/admin';

expect.extend(toHaveNoViolations);

jest.mock('@/features/admin', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockApiGet = apiClient.get as jest.Mock;
const mockApiPost = apiClient.post as jest.Mock;

function MockStudioEditor({ initialLabel = 'Initial Headline' }: { initialLabel?: string }) {
  const [localTitle, setLocalTitle] = useState(initialLabel);
  const [localNotes, setLocalNotes] = useState('');

  return (
    <div>
      <label htmlFor="studio-title-input">Studio Title</label>
      <input
        id="studio-title-input"
        type="text"
        value={localTitle}
        onChange={(e) => setLocalTitle(e.target.value)}
      />
      <label htmlFor="studio-notes-input">Unsaved Studio Notes</label>
      <textarea
        id="studio-notes-input"
        value={localNotes}
        onChange={(e) => setLocalNotes(e.target.value)}
      />
    </div>
  );
}

describe('AdminPreviewLayout studio draft preservation & accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockResolvedValue([
      {
        id: 'ver-1',
        createdAt: '2026-08-01T12:00:00.000Z',
        author: 'Admin',
        data: { title: 'Saved Snapshot v1' },
      },
    ]);
    mockApiPost.mockResolvedValue({ success: true });
  });

  it('keeps active studio editors mounted across Version History toggles with hidden and aria-hidden panes', async () => {
    const { container } = render(
      <ToastProvider>
        <AdminPreviewLayout
          previewUrl="/things-to-do"
          draftType="attractions"
          draftData={{ title: 'Draft' }}
          entityId="attr-1"
        >
          <MockStudioEditor />
        </AdminPreviewLayout>
      </ToastProvider>
    );

    const titleInput = screen.getByLabelText('Studio Title');
    const notesInput = screen.getByLabelText('Unsaved Studio Notes');

    fireEvent.change(titleInput, { target: { value: 'Edited Unsaved Attraction' } });
    fireEvent.change(notesInput, { target: { value: 'Keep these studio edits across history toggle' } });

    const editorPane = screen.getByTestId('studio-editor-pane');
    const historyPane = screen.getByTestId('studio-history-pane');

    expect(editorPane).not.toHaveAttribute('hidden');
    expect(editorPane).toHaveAttribute('aria-hidden', 'false');
    expect(historyPane).toHaveAttribute('hidden');
    expect(historyPane).toHaveAttribute('aria-hidden', 'true');

    // Open Version History
    fireEvent.click(screen.getByRole('button', { name: 'Version History' }));

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/admin/versions?entityType=Attraction&entityId=attr-1'
      );
      expect(screen.getByText('By Admin')).toBeInTheDocument();
    });

    // Editor pane stays mounted in DOM but is hidden from layout & assistive tech
    expect(editorPane).toHaveAttribute('hidden');
    expect(editorPane).toHaveAttribute('aria-hidden', 'true');
    expect(historyPane).not.toHaveAttribute('hidden');
    expect(historyPane).toHaveAttribute('aria-hidden', 'false');
    expect(titleInput).toBeInTheDocument();

    const axeResultsHistoryOpen = await axe(container);
    expect(axeResultsHistoryOpen).toHaveNoViolations();

    // Close Version History and verify unsaved edits remain intact on the same mounted input nodes
    fireEvent.click(screen.getByRole('button', { name: 'Hide History' }));

    expect(editorPane).not.toHaveAttribute('hidden');
    expect(editorPane).toHaveAttribute('aria-hidden', 'false');
    expect(historyPane).toHaveAttribute('hidden');
    expect(historyPane).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText('Studio Title')).toBe(titleInput);
    expect(titleInput).toHaveValue('Edited Unsaved Attraction');
    expect(notesInput).toHaveValue('Keep these studio edits across history toggle');

    const axeResultsHistoryClosed = await axe(container);
    expect(axeResultsHistoryClosed).toHaveNoViolations();
  });

  it('confirms via ToastProvider.confirm before restoring an earlier snapshot and invokes onRestore', async () => {
    const onRestore = jest.fn();

    render(
      <ToastProvider>
        <AdminPreviewLayout
          previewUrl="/wedding-party"
          draftType="wedding-party"
          draftData={[]}
          entityId="member-1"
          onRestore={onRestore}
        >
          <MockStudioEditor />
        </AdminPreviewLayout>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Version History' }));
    const restoreBtn = await screen.findByRole('button', { name: 'Restore' });

    // Cancel restore first
    fireEvent.click(restoreBtn);
    const cancelDialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(cancelDialog).getByRole('button', { name: 'Cancel' }));
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();

    // Confirm restore
    fireEvent.click(restoreBtn);
    const confirmDialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/admin/versions/ver-1/restore');
      expect(onRestore).toHaveBeenCalledTimes(1);
    });
  });

  it('inserts ?preview=true before hash fragments, scopes postMessage to window.location.origin, and switches mobile Editor / Live Preview tabs cleanly', async () => {
    const postMessageSpy = jest.fn();

    const { container, rerender } = render(
      <ToastProvider>
        <AdminPreviewLayout
          previewUrl="/#schedule"
          draftType="content"
          draftData={[{ id: 's1', type: 'Schedule', data: { title: 'Ceremony' } }]}
          entityId="s1"
        >
          <MockStudioEditor />
        </AdminPreviewLayout>
      </ToastProvider>
    );

    const iframe = screen.getByTitle('Live Preview') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toBe('/?preview=true#schedule');

    const originalContentWindowDesc = Object.getOwnPropertyDescriptor(iframe, 'contentWindow');
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: { postMessage: postMessageSpy },
    });

    fireEvent.load(iframe);
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'DRAFT_UPDATE',
        draftType: 'content',
        draftData: [{ id: 's1', type: 'Schedule', data: { title: 'Ceremony' } }],
      },
      window.location.origin
    );
    expect(postMessageSpy).not.toHaveBeenCalledWith(expect.anything(), '*');

    if (originalContentWindowDesc) {
      Object.defineProperty(iframe, 'contentWindow', originalContentWindowDesc);
    } else {
      delete (iframe as { contentWindow?: unknown }).contentWindow;
    }

    // Mobile tab controls switch between Editor and Live Preview panes
    const mobileTabs = screen.getByTestId('studio-mobile-tabs');
    const editorTab = within(mobileTabs).getByTestId('studio-mobile-tab-editor');
    const previewTab = within(mobileTabs).getByTestId('studio-mobile-tab-preview');
    const leftPane = screen.getByTestId('studio-left-pane');
    const rightPane = screen.getByTestId('studio-right-pane');

    expect(editorTab).toHaveAttribute('aria-selected', 'true');
    expect(previewTab).toHaveAttribute('aria-selected', 'false');
    expect(leftPane).toHaveClass('w-full', 'md:w-1/2');
    expect(rightPane).toHaveClass('hidden', 'md:flex');

    fireEvent.click(previewTab);
    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(editorTab).toHaveAttribute('aria-selected', 'false');
    expect(leftPane).toHaveClass('hidden', 'md:flex');
    expect(rightPane).toHaveClass('flex', 'w-full', 'md:w-1/2');

    // Also verify /photos preview URL without hash
    rerender(
      <ToastProvider>
        <AdminPreviewLayout
          previewUrl="/photos"
          draftType="content"
          draftData={[]}
        >
          <MockStudioEditor />
        </AdminPreviewLayout>
      </ToastProvider>
    );
    expect((screen.getByTitle('Live Preview') as HTMLIFrameElement).getAttribute('src')).toBe(
      '/photos?preview=true'
    );

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });
});
