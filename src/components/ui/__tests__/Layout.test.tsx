import React from 'react';
import { render, screen } from '@testing-library/react';
import { Container, Card, Heading } from '../Layout';

describe('Layout Components', () => {
  test('Layout components render without crashing', () => {
    render(
      <Container>
        <Card>
          <Heading>Content</Heading>
        </Card>
      </Container>
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  test('does not contain hardcoded rose classes', () => {
    const { container } = render(
      <Container data-testid="container">
        <Card data-testid="card">
          <Heading data-testid="heading">Title</Heading>
        </Card>
      </Container>
    );

    const containerEl = screen.getByTestId('container');
    const cardEl = screen.getByTestId('card');
    const headingEl = screen.getByTestId('heading');

    expect(containerEl.className).not.toContain('bg-rose-50');
    expect(headingEl.className).not.toContain('text-rose-700');
  });

  test('applies theme CSS custom property fallbacks in style attribute', () => {
    render(
      <Container data-testid="container">
        <Card data-testid="card">
          <Heading data-testid="heading">Header</Heading>
        </Card>
      </Container>
    );

    const containerEl = screen.getByTestId('container');
    const cardEl = screen.getByTestId('card');
    const headingEl = screen.getByTestId('heading');

    expect(containerEl.style.backgroundColor).toContain('var(--container-bg');
    expect(cardEl.style.backgroundColor).toContain('var(--card-bg');
    expect(cardEl.style.borderColor).toContain('var(--card-border');
    expect(cardEl.style.boxShadow).toContain('var(--card-shadow');
    expect(headingEl.style.color).toContain('var(--heading-color');
  });

  test('merges custom className and style props cleanly', () => {
    render(
      <Container data-testid="container" className="custom-container" style={{ marginTop: '10px' }}>
        <Card data-testid="card" className="custom-card" style={{ padding: '5px' }}>
          <Heading data-testid="heading" className="custom-heading" style={{ fontSize: '30px' }}>
            Custom Layout
          </Heading>
        </Card>
      </Container>
    );

    const containerEl = screen.getByTestId('container');
    const cardEl = screen.getByTestId('card');
    const headingEl = screen.getByTestId('heading');

    expect(containerEl).toHaveClass('custom-container');
    expect(containerEl.style.marginTop).toBe('10px');
    expect(containerEl.style.backgroundColor).toContain('var(--container-bg');

    expect(cardEl).toHaveClass('custom-card');
    expect(cardEl.style.padding).toBe('5px');

    expect(headingEl).toHaveClass('custom-heading');
    expect(headingEl.style.fontSize).toBe('30px');
  });

  test('supports ref forwarding for all components', () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const cardRef = React.createRef<HTMLDivElement>();
    const headingRef = React.createRef<HTMLHeadingElement>();

    render(
      <Container ref={containerRef}>
        <Card ref={cardRef}>
          <Heading ref={headingRef}>Ref Test</Heading>
        </Card>
      </Container>
    );

    expect(containerRef.current).toBeInstanceOf(HTMLDivElement);
    expect(cardRef.current).toBeInstanceOf(HTMLDivElement);
    expect(headingRef.current).toBeInstanceOf(HTMLHeadingElement);
  });
});
