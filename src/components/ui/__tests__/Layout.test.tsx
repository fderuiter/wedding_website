import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  Container,
  Card,
  Heading,
  MainLandmark,
  SiteFooter,
  type HeadingLevel,
  type HeadingProps,
  type HeadingVariant,
  type MainLandmarkProps,
  type SiteFooterProps,
} from '../Layout';

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
    render(
      <Container data-testid="container">
        <Card data-testid="card">
          <Heading data-testid="heading">Title</Heading>
        </Card>
      </Container>
    );

    const containerEl = screen.getByTestId('container');
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

  test('Heading accepts HeadingProps and renders as h1 by default when as prop is omitted', () => {
    const props: HeadingProps & { 'data-testid'?: string } = {
      'data-testid': 'default-heading',
      children: 'Default Title',
    };
    render(<Heading {...props} />);
    const heading = screen.getByTestId('default-heading');
    expect(heading.tagName).toBe('H1');
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading);
  });

  const headingLevels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

  test.each(headingLevels)('Heading renders as <%s> tag and preserves styling and attributes', (level) => {
    const numericLevel = parseInt(level.replace('h', ''), 10);
    render(
      <Heading as={level} data-testid={`heading-${level}`} className="custom-heading-class">
        Level {numericLevel}
      </Heading>
    );

    const heading = screen.getByTestId(`heading-${level}`);
    expect(heading.tagName).toBe(level.toUpperCase());
    expect(screen.getByRole('heading', { level: numericLevel })).toBe(heading);
    expect(heading).toHaveClass('custom-heading-class', 'text-2xl', 'font-bold');
    expect(heading.style.color).toContain('var(--heading-color');
  });

  test.each(headingLevels)('Heading forwards ref to HTMLHeadingElement for level %s', (level) => {
    const ref = React.createRef<HTMLHeadingElement>();
    render(
      <Heading as={level} ref={ref}>
        Ref Test {level}
      </Heading>
    );

    expect(ref.current).toBeInstanceOf(HTMLHeadingElement);
    expect(ref.current?.tagName).toBe(level.toUpperCase());
  });

  const variantCases: Array<{ as: HeadingLevel; variant: HeadingVariant; expectedClass?: string }> = [
    { as: 'h1', variant: 'display', expectedClass: 'type-display' },
    { as: 'h2', variant: 'h1', expectedClass: 'type-h1' },
    { as: 'h3', variant: 'h2', expectedClass: 'type-h2' },
    { as: 'h2', variant: 'h3', expectedClass: 'type-h3' },
    { as: 'h4', variant: 'none' },
  ];

  test.each(variantCases)(
    'Heading decouples semantic tag <$as> from typography variant "$variant"',
    ({ as, variant, expectedClass }) => {
      render(
        <Heading as={as} variant={variant} unstyledColor data-testid="variant-heading" className="extra-cls">
          Polymorphic Heading
        </Heading>
      );

      const heading = screen.getByTestId('variant-heading');
      expect(heading.tagName).toBe(as.toUpperCase());
      expect(heading).toHaveClass('extra-cls');
      expect(heading).not.toHaveClass('text-2xl');
      if (expectedClass) {
        expect(heading).toHaveClass(expectedClass);
      }
      expect(heading.style.color).toBe('');
    }
  );

  test('MainLandmark renders main#main-content with tabIndex=-1 by default, forwards ref, and supports suppressLandmark', () => {
    const mainRef = React.createRef<HTMLElement>();
    const mainProps: MainLandmarkProps = {
      'aria-label': 'Primary Content',
      className: 'custom-main',
      style: { paddingTop: '64px' },
    };

    const { rerender } = render(
      <MainLandmark ref={mainRef} {...mainProps}>
        Main Child
      </MainLandmark>
    );

    const mainEl = screen.getByRole('main', { name: 'Primary Content' });
    expect(mainEl).toHaveAttribute('id', 'main-content');
    expect(mainEl).toHaveAttribute('tabindex', '-1');
    expect(mainEl).toHaveClass('custom-main');
    expect(mainEl).toHaveStyle({ paddingTop: '64px' });
    expect(mainRef.current).toBe(mainEl);

    rerender(
      <MainLandmark
        ref={mainRef}
        suppressLandmark
        role="region"
        aria-label="Preview Content"
        className="preview-wrapper"
      >
        Preview Child
      </MainLandmark>
    );

    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    const previewEl = screen.getByRole('region', { name: 'Preview Content' });
    expect(previewEl.tagName).toBe('DIV');
    expect(previewEl).toHaveAttribute('id', 'main-content');
    expect(previewEl).toHaveAttribute('tabindex', '-1');
    expect(previewEl).toHaveClass('preview-wrapper');
  });

  test('SiteFooter renders top-level contentinfo footer, forwards ref, and supports suppressLandmark', () => {
    const footerRef = React.createRef<HTMLElement>();
    const footerProps: SiteFooterProps = {
      className: 'pb-16',
    };

    const { rerender } = render(
      <SiteFooter ref={footerRef} {...footerProps}>
        Footer Text
      </SiteFooter>
    );

    const footerEl = screen.getByRole('contentinfo');
    expect(footerEl.tagName).toBe('FOOTER');
    expect(footerEl).toHaveClass('pb-16');
    expect(footerEl).toHaveTextContent('Footer Text');
    expect(footerRef.current).toBe(footerEl);

    rerender(
      <SiteFooter suppressLandmark data-testid="suppressed-footer">
        Preview Footer
      </SiteFooter>
    );

    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(screen.getByTestId('suppressed-footer').tagName).toBe('DIV');
  });
});
