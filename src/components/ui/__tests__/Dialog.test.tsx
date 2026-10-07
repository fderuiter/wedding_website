import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Dialog } from '../Dialog';

describe('Dialog', () => {
  test('Dialog renders without crashing', () => {
    render(<Dialog isOpen={true} onClose={() => {}}>Content</Dialog>);
  });

  test('forwards ref and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Dialog ref={ref} isOpen={true} onClose={() => {}} className="custom-dialog-class">
        Content
      </Dialog>
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveClass('custom-dialog-class');
    expect(ref.current).toHaveClass('bg-white');
  });

  test('renders with a single dialog role and modal attributes', () => {
    const { getAllByRole, getByRole } = render(
      <Dialog isOpen={true} onClose={() => {}} title="Test Title" description="Test Description">
        Content
      </Dialog>
    );

    const dialogs = getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);

    const dialog = getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
  });

  test('renders with alertdialog role when role prop is alertdialog', () => {
    const { getAllByRole, queryAllByRole, getByRole } = render(
      <Dialog isOpen={true} onClose={() => {}} role="alertdialog" title="Alert Title">
        Alert Content
      </Dialog>
    );

    expect(queryAllByRole('dialog')).toHaveLength(0);
    const alertdialogs = getAllByRole('alertdialog');
    expect(alertdialogs).toHaveLength(1);

    const alertdialog = getByRole('alertdialog');
    expect(alertdialog).toHaveAttribute('aria-modal', 'true');
  });
});

