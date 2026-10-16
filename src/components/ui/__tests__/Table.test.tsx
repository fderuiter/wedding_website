import React from 'react';
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

  test('handles keyboard arrow navigation on container', () => {
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

    Object.defineProperty(region, 'scrollWidth', {
      get: () => 200,
      configurable: true,
    });

    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(scrollLeft).toBe(90);

    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(scrollLeft).toBe(50);

    fireEvent.keyDown(region, { key: 'ArrowDown' });
    expect(scrollTop).toBe(90);

    fireEvent.keyDown(region, { key: 'ArrowUp' });
    expect(scrollTop).toBe(50);

    fireEvent.keyDown(region, { key: 'End' });
    expect(scrollLeft).toBe(200);

    fireEvent.keyDown(region, { key: 'Home' });
    expect(scrollLeft).toBe(0);

    expect(onKeyDownMock).toHaveBeenCalled();
  });
});

