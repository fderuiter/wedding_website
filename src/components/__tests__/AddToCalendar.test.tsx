import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import AddToCalendar, { CalendarEvent } from '../AddToCalendar'
import * as calendarUtils from '@/utils/calendar'

// Mock the calendar utility functions
jest.mock('@/utils/calendar', () => ({
  createGoogleCalendarLink: jest.fn(),
  createYahooCalendarLink: jest.fn(),
  createIcsFile: jest.fn(),
}))

// Mock window.open
const mockWindowOpen = jest.fn()
Object.defineProperty(window, 'open', { value: mockWindowOpen })

// Mock URL.createObjectURL and the download link logic
const mockCreateObjectURL = jest.fn(() => 'blob:http://localhost/mock-url')
const mockRevokeObjectURL = jest.fn()
Object.defineProperty(window.URL, 'createObjectURL', { value: mockCreateObjectURL })
Object.defineProperty(window.URL, 'revokeObjectURL', { value: mockRevokeObjectURL })


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
  }

  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks()
  })

  it('renders the "Add to Calendar" button', () => {
    render(<AddToCalendar event={sampleEvent} />)
    expect(screen.getByText('Add to Calendar')).toBeInTheDocument()
  })

  it('opens the dropdown when the button is clicked', () => {
    render(<AddToCalendar event={sampleEvent} />)
    fireEvent.click(screen.getByText('Add to Calendar'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('Google')).toBeInTheDocument()
    expect(screen.getByText('Yahoo')).toBeInTheDocument()
    expect(screen.getByText('Apple')).toBeInTheDocument()
  })

  it('calls createGoogleCalendarLink and window.open when Google is clicked', () => {
    render(<AddToCalendar event={sampleEvent} />)
    fireEvent.click(screen.getByText('Add to Calendar'))
    fireEvent.click(screen.getByText('Google'))

    expect(calendarUtils.createGoogleCalendarLink).toHaveBeenCalledWith(sampleEvent)
    expect(mockWindowOpen).toHaveBeenCalled()
  })

  it('calls createYahooCalendarLink and window.open when Yahoo is clicked', () => {
    render(<AddToCalendar event={sampleEvent} />)
    fireEvent.click(screen.getByText('Add to Calendar'))
    fireEvent.click(screen.getByText('Yahoo'))

    expect(calendarUtils.createYahooCalendarLink).toHaveBeenCalledWith(sampleEvent)
    expect(mockWindowOpen).toHaveBeenCalled()
  })

  it('calls createIcsFile and triggers a download when Apple is clicked', () => {
    (calendarUtils.createIcsFile as jest.Mock).mockReturnValue('mock ics content')
    render(<AddToCalendar event={sampleEvent} />)
    fireEvent.click(screen.getByText('Add to Calendar'))
    fireEvent.click(screen.getByText('Apple'))

    expect(calendarUtils.createIcsFile).toHaveBeenCalledWith(sampleEvent)
    expect(mockCreateObjectURL).toHaveBeenCalled()
  })

  it('closes the dropdown when Escape key is pressed', () => {
    render(<AddToCalendar event={sampleEvent} />)
    fireEvent.click(screen.getByText('Add to Calendar'))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('manages focus with Arrow keys', () => {
    render(<AddToCalendar event={sampleEvent} />)
    fireEvent.click(screen.getByText('Add to Calendar'))

    const googleButton = screen.getByText('Google')
    const appleButton = screen.getByText('Apple')

    // Focus should be on the first item (Google) initially or we can set it
    googleButton.focus()
    expect(document.activeElement).toBe(googleButton)

    // Arrow Down -> Apple
    fireEvent.keyDown(googleButton, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(appleButton)

    // Arrow Up -> Google
    fireEvent.keyDown(appleButton, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(googleButton)
  })

  it('returns focus to trigger button on Escape', () => {
    render(<AddToCalendar event={sampleEvent} />)
    const trigger = screen.getByText('Add to Calendar')
    fireEvent.click(trigger)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
  })
})
