import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import HeartPage from '../page'

// Mock @react-three/fiber to avoid WebGL context issues in tests
jest.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => (
    <canvas>{children}</canvas>
  ),
  useFrame: () => {},
}))

// Mock Drei components used within the page
jest.mock('@react-three/drei', () => ({
  Environment: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Html: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Float: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  PresentationControls: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

// Mock postprocessing components
jest.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Bloom: () => null,
}))

describe('Heart page', () => {
  it('renders the 3D heart canvas or heading', () => {
    const { container } = render(<HeartPage />)
    const canvas = container.querySelector('canvas') as HTMLElement | null
    const heading = screen.queryByRole('heading', { level: 1 })
    expect(canvas ?? heading).toBeInTheDocument()
  })
})

