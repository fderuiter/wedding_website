import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import { Icon } from '../Icon';

describe('Icon', () => {
  test('Icon renders without crashing', () => {
    render(<Icon name="X" />);
  });

  test('forwards ref and merges custom className via cn()', () => {
    const ref = React.createRef<SVGSVGElement>();
    const { container } = render(<Icon ref={ref} name="X" className="custom-icon-class text-red-500" />);

    expect(ref.current).toBeInstanceOf(SVGSVGElement);
    expect(container.firstChild).toHaveClass('custom-icon-class');
    expect(container.firstChild).toHaveClass('text-red-500');
  });

  describe('Accessibility & aria-hidden defaults', () => {
    test('defaults aria-hidden="true" when no accessibility props are provided', async () => {
      const { container } = render(<Icon name="X" />);
      const svg = container.querySelector('svg');

      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).not.toHaveAttribute('role');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    test('preserves explicit aria-hidden={false} on the underlying SVG element', () => {
      const { container } = render(<Icon name="X" aria-hidden={false} />);
      const svg = container.querySelector('svg');

      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('aria-hidden', 'false');
    });

    test('preserves explicit aria-hidden={true} on the underlying SVG element', () => {
      const { container } = render(<Icon name="X" aria-hidden={true} />);
      const svg = container.querySelector('svg');

      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });

    test('preserves explicit string aria-hidden="false" and aria-hidden="true"', () => {
      const { container: containerFalse } = render(<Icon name="X" aria-hidden="false" />);
      expect(containerFalse.querySelector('svg')).toHaveAttribute('aria-hidden', 'false');

      const { container: containerTrue } = render(<Icon name="X" aria-hidden="true" />);
      expect(containerTrue.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    test('omits aria-hidden and applies role="img" when aria-label is provided', async () => {
      const { container } = render(<Icon name="X" aria-label="Close dialog" />);
      const svg = container.querySelector('svg');

      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('role', 'img');
      expect(svg).toHaveAttribute('aria-label', 'Close dialog');
      expect(svg).not.toHaveAttribute('aria-hidden');

      const accessibleImg = screen.getByRole('img', { name: 'Close dialog' });
      expect(accessibleImg).toBe(svg);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    test('omits aria-hidden and applies role="img" when aria-labelledby is provided', () => {
      const { container } = render(
        <div>
          <span id="close-label">Close dialog</span>
          <Icon name="X" aria-labelledby="close-label" />
        </div>
      );
      const svg = container.querySelector('svg');

      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('role', 'img');
      expect(svg).toHaveAttribute('aria-labelledby', 'close-label');
      expect(svg).not.toHaveAttribute('aria-hidden');

      const accessibleImg = screen.getByRole('img', { name: 'Close dialog' });
      expect(accessibleImg).toBe(svg);
    });

    test('preserves explicit caller role when provided with aria-label', () => {
      const { container } = render(<Icon name="X" aria-label="Close modal" role="button" />);
      const svg = container.querySelector('svg');

      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('role', 'button');
      expect(svg).toHaveAttribute('aria-label', 'Close modal');
      expect(svg).not.toHaveAttribute('aria-hidden');
    });

    test('respects explicit aria-hidden even when aria-label is also provided', () => {
      const { container } = render(<Icon name="X" aria-label="Decorative label" aria-hidden={true} />);
      const svg = container.querySelector('svg');

      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });
});

