import { render, screen, fireEvent } from '@testing-library/react';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '../Table';

describe('Table Component Accessibility & Functionality', () => {
  test('Table renders without crashing and includes region role and tabIndex', () => {
    render(
      <Table>
        <TableCaption>Guest Seating Arrangement</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Table Number</TableHead>
            <TableHead>Capacity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Table 1</TableCell>
            <TableCell>8</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Total Tables: 1</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    );

    const region = screen.getByRole('region', { name: 'Scrollable table' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Guest Seating Arrangement')).toBeInTheDocument();
    expect(screen.getByText('Table Number')).toBeInTheDocument();
    expect(screen.getByText('Table 1')).toBeInTheDocument();
    expect(screen.getByText('Total Tables: 1')).toBeInTheDocument();
  });

  test('supports custom containerAriaLabel and containerClassName', () => {
    render(
      <Table
        containerAriaLabel="Custom Table Region"
        containerClassName="custom-container-class"
      >
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const region = screen.getByRole('region', { name: 'Custom Table Region' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveClass('custom-container-class');
  });

  test('inherits aria-label or aria-labelledby from table props if set', () => {
    render(
      <div>
        <h2 id="table-heading">Guest Roster</h2>
        <Table aria-labelledby="table-heading">
          <TableBody>
            <TableRow>
              <TableCell>John Doe</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );

    const region = screen.getByRole('region', { name: 'Guest Roster' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-labelledby', 'table-heading');
  });

  test('handles keyboard arrow navigation on overflowing container', () => {
    const onKeyDownMock = jest.fn();
    render(
      <Table containerProps={{ onKeyDown: onKeyDownMock }}>
        <TableBody>
          <TableRow>
            <TableCell>Scrollable Data</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const region = screen.getByRole('region', { name: 'Scrollable table' });

    let scrollLeft = 50;
    let scrollTop = 50;

    Object.defineProperty(region, 'scrollLeft', {
      get: () => scrollLeft,
      set: (val) => {
        scrollLeft = val;
      },
      configurable: true,
    });

    Object.defineProperty(region, 'scrollTop', {
      get: () => scrollTop,
      set: (val) => {
        scrollTop = val;
      },
      configurable: true,
    });

    Object.defineProperty(region, 'clientWidth', {
      get: () => 100,
      configurable: true,
    });

    Object.defineProperty(region, 'scrollWidth', {
      get: () => 200,
      configurable: true,
    });

    Object.defineProperty(region, 'clientHeight', {
      get: () => 100,
      configurable: true,
    });

    Object.defineProperty(region, 'scrollHeight', {
      get: () => 200,
      configurable: true,
    });

    expect(fireEvent.keyDown(region, { key: 'ArrowRight' })).toBe(false);
    expect(scrollLeft).toBe(90);

    expect(fireEvent.keyDown(region, { key: 'ArrowLeft' })).toBe(false);
    expect(scrollLeft).toBe(50);

    expect(fireEvent.keyDown(region, { key: 'ArrowDown' })).toBe(false);
    expect(scrollTop).toBe(90);

    expect(fireEvent.keyDown(region, { key: 'ArrowUp' })).toBe(false);
    expect(scrollTop).toBe(50);

    expect(fireEvent.keyDown(region, { key: 'End' })).toBe(false);
    expect(scrollLeft).toBe(200);

    expect(fireEvent.keyDown(region, { key: 'Home' })).toBe(false);
    expect(scrollLeft).toBe(0);

    expect(fireEvent.keyDown(region, { key: 'Tab' })).toBe(true);
    expect(onKeyDownMock).toHaveBeenCalledTimes(7);
  });

  test('skips scrolling and preventDefault when keys bubble from child controls', () => {
    const onKeyDownMock = jest.fn();
    render(
      <Table containerProps={{ onKeyDown: onKeyDownMock }}>
        <TableBody>
          <TableRow>
            <TableCell>
              <input aria-label="Text input" defaultValue="Sample" />
              <input type="date" aria-label="Sent date" defaultValue="2026-06-15" />
              <textarea aria-label="Note draft" defaultValue="Thank you!" />
              <select aria-label="Thank-you status" defaultValue="Unsent">
                <option value="Unsent">Unsent</option>
                <option value="Sent">Sent</option>
              </select>
              <button type="button">Edit</button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const region = screen.getByRole('region', { name: 'Scrollable table' });
    let scrollLeft = 50;
    let scrollTop = 50;

    Object.defineProperty(region, 'scrollLeft', {
      get: () => scrollLeft,
      set: (val) => {
        scrollLeft = val;
      },
      configurable: true,
    });
    Object.defineProperty(region, 'scrollTop', {
      get: () => scrollTop,
      set: (val) => {
        scrollTop = val;
      },
      configurable: true,
    });
    Object.defineProperty(region, 'clientWidth', { get: () => 100, configurable: true });
    Object.defineProperty(region, 'scrollWidth', { get: () => 300, configurable: true });
    Object.defineProperty(region, 'clientHeight', { get: () => 100, configurable: true });
    Object.defineProperty(region, 'scrollHeight', { get: () => 300, configurable: true });

    const controls = [
      screen.getByLabelText('Text input'),
      screen.getByLabelText('Sent date'),
      screen.getByLabelText('Note draft'),
      screen.getByLabelText('Thank-you status'),
      screen.getByRole('button', { name: 'Edit' }),
    ];
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

    for (const control of controls) {
      for (const key of keys) {
        const notPrevented = fireEvent.keyDown(control, { key });
        expect(notPrevented).toBe(true);
        expect(scrollLeft).toBe(50);
        expect(scrollTop).toBe(50);
      }
    }

    expect(onKeyDownMock).toHaveBeenCalledTimes(controls.length * keys.length);
  });

  test('skips scrolling and preventDefault on non-overflowing axes', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Static Data</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const region = screen.getByRole('region', { name: 'Scrollable table' });
    let scrollLeft = 50;
    let scrollTop = 50;
    let scrollWidth = 100;
    let scrollHeight = 100;

    Object.defineProperty(region, 'scrollLeft', {
      get: () => scrollLeft,
      set: (val) => {
        scrollLeft = val;
      },
      configurable: true,
    });
    Object.defineProperty(region, 'scrollTop', {
      get: () => scrollTop,
      set: (val) => {
        scrollTop = val;
      },
      configurable: true,
    });
    Object.defineProperty(region, 'clientWidth', { get: () => 100, configurable: true });
    Object.defineProperty(region, 'scrollWidth', { get: () => scrollWidth, configurable: true });
    Object.defineProperty(region, 'clientHeight', { get: () => 100, configurable: true });
    Object.defineProperty(region, 'scrollHeight', { get: () => scrollHeight, configurable: true });

    // Neither axis overflows
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(fireEvent.keyDown(region, { key })).toBe(true);
    }
    expect(scrollLeft).toBe(50);
    expect(scrollTop).toBe(50);

    // Only horizontal axis overflows: vertical keys still allow native page scroll
    scrollWidth = 250;
    expect(fireEvent.keyDown(region, { key: 'ArrowUp' })).toBe(true);
    expect(fireEvent.keyDown(region, { key: 'ArrowDown' })).toBe(true);
    expect(scrollTop).toBe(50);
    expect(fireEvent.keyDown(region, { key: 'ArrowRight' })).toBe(false);
    expect(scrollLeft).toBe(90);

    // Only vertical axis overflows: horizontal keys allow native behavior
    scrollWidth = 100;
    scrollHeight = 250;
    expect(fireEvent.keyDown(region, { key: 'ArrowLeft' })).toBe(true);
    expect(fireEvent.keyDown(region, { key: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyDown(region, { key: 'Home' })).toBe(true);
    expect(fireEvent.keyDown(region, { key: 'End' })).toBe(true);
    expect(scrollLeft).toBe(90);
    expect(fireEvent.keyDown(region, { key: 'ArrowDown' })).toBe(false);
    expect(scrollTop).toBe(90);
  });

  test('respects defaultPrevented from containerProps.onKeyDown', () => {
    const onKeyDownMock = jest.fn((e: React.KeyboardEvent<HTMLDivElement>) => {
      e.preventDefault();
    });

    render(
      <Table containerProps={{ onKeyDown: onKeyDownMock }}>
        <TableBody>
          <TableRow>
            <TableCell>Custom Handled Data</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const region = screen.getByRole('region', { name: 'Scrollable table' });
    let scrollLeft = 50;

    Object.defineProperty(region, 'scrollLeft', {
      get: () => scrollLeft,
      set: (val) => {
        scrollLeft = val;
      },
      configurable: true,
    });
    Object.defineProperty(region, 'clientWidth', { get: () => 100, configurable: true });
    Object.defineProperty(region, 'scrollWidth', { get: () => 200, configurable: true });

    expect(fireEvent.keyDown(region, { key: 'ArrowRight' })).toBe(false);
    expect(scrollLeft).toBe(50);
    expect(onKeyDownMock).toHaveBeenCalledTimes(1);
  });

  test('defaults scroll region to relative positioning while preserving explicit container position overrides', () => {
    const { rerender } = render(
      <Table containerAriaLabel="Thank-you notes">
        <TableBody>
          <TableRow>
            <TableCell>Row 1</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    let region = screen.getByRole('region', { name: 'Thank-you notes' });
    expect(region).toHaveClass('relative');

    rerender(
      <Table containerAriaLabel="Thank-you notes" containerClassName="sticky top-0">
        <TableBody>
          <TableRow>
            <TableCell>Row 1</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    region = screen.getByRole('region', { name: 'Thank-you notes' });
    expect(region).toHaveClass('sticky');
    expect(region).not.toHaveClass('relative');
  });
});

