import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

interface ButtonProps {
  name: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timeZone: string;
  location: string;
  description: string;
  [key: string]: unknown;
}

jest.mock('next/dynamic', () => {
  return () => {
    const MockAddToCalendarButton = ({
      name,
      startDate,
      startTime,
      endDate,
      endTime,
      timeZone,
      location,
      description,
      ...rest
    }: ButtonProps) => {
      // The component being mocked accepts custom style props, but the DOM <button> does not.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { buttonStyle, styleLight, styleDark, ...domProps } = rest
      return (
        <button
          data-testid="add-to-calendar-button"
          data-name={name}
          data-start-date={startDate}
          data-start-time={startTime}
          data-end-date={endDate}
          data-end-time={endTime}
          data-time-zone={timeZone}
          data-location={location}
          data-description={description}
          {...domProps}
        />
      )
    };
    MockAddToCalendarButton.displayName = 'MockAddToCalendarButton';
    return MockAddToCalendarButton;
  };
});

import AddToCalendar, { CalendarEvent } from '../AddToCalendar';

describe('AddToCalendar', () => {
  const sampleEvent: CalendarEvent = {
    name: 'Sample Event',
    startDate: '2025-10-15',
    startTime: '15:00',
    endDate: '2025-10-15',
    endTime: '23:00',
    timeZone: 'America/New_York',
    location: 'Test Location',
    description: 'Event Description',
  };

  it('renders button with event attributes', () => {
    render(<AddToCalendar event={sampleEvent} />);
    const button = screen.getByTestId('add-to-calendar-button');
    expect(button).toHaveAttribute('data-name', sampleEvent.name);
    expect(button).toHaveAttribute('data-start-date', sampleEvent.startDate);
    expect(button).toHaveAttribute('data-start-time', sampleEvent.startTime);
    expect(button).toHaveAttribute('data-end-date', sampleEvent.endDate);
    expect(button).toHaveAttribute('data-end-time', sampleEvent.endTime);
    expect(button).toHaveAttribute('data-time-zone', sampleEvent.timeZone);
    expect(button).toHaveAttribute('data-location', sampleEvent.location);
    expect(button).toHaveAttribute('data-description', sampleEvent.description);
  });

  it('sets tabindex="-1" on hidden elements', () => {
    const hiddenDiv = document.createElement('div');
    hiddenDiv.setAttribute('data-aria-hidden', 'true');
    hiddenDiv.setAttribute('aria-hidden', 'true');
    const childBtn = document.createElement('button');
    const childLink = document.createElement('a');
    hiddenDiv.appendChild(childBtn);
    hiddenDiv.appendChild(childLink);

    const docQuerySpy = jest
      .spyOn(document, 'querySelectorAll')
      .mockReturnValue([hiddenDiv] as unknown as NodeListOf<Element>);
    const elementQuerySpy = jest
      .spyOn(hiddenDiv, 'querySelectorAll')
      .mockReturnValue([childBtn, childLink] as unknown as NodeListOf<HTMLElement>);

    render(<AddToCalendar event={sampleEvent} />);

    expect(docQuerySpy).toHaveBeenCalledWith('div[data-aria-hidden="true"][aria-hidden="true"]');
    expect(hiddenDiv.getAttribute('tabindex')).toBe('-1');
    expect(childBtn.getAttribute('tabindex')).toBe('-1');
    expect(childLink.getAttribute('tabindex')).toBe('-1');

    docQuerySpy.mockRestore();
    elementQuerySpy.mockRestore();
  });
});
