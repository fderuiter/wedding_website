import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { axe } from 'jest-axe';
import { MediaImage } from '../MediaImage';
import { createMockMedia } from '@/testing/factories/mediaFactory';

describe('MediaImage Component', () => {
  describe('Protocol Allowlist Validation & Security Filtering', () => {
    it('permits valid http:// image URLs', () => {
      const httpMedia = createMockMedia({ url: 'http://example.com/photo.jpg' });
      const { getByRole } = render(<MediaImage media={httpMedia} />);
      const img = getByRole('img');
      expect(img).toHaveAttribute('src', 'http://example.com/photo.jpg');
    });

    it('permits valid https:// image URLs', () => {
      const httpsMedia = createMockMedia({ url: 'https://example.com/secure-photo.jpg' });
      const { getByRole } = render(<MediaImage media={httpsMedia} />);
      const img = getByRole('img');
      expect(img).toHaveAttribute('src', 'https://example.com/secure-photo.jpg');
    });

    it('permits valid relative image URLs starting with /', () => {
      const relativeMedia = createMockMedia({ url: '/uploads/gallery/pic.png' });
      const { getByRole } = render(<MediaImage media={relativeMedia} />);
      const img = getByRole('img');
      expect(img).toHaveAttribute('src', '/uploads/gallery/pic.png');
    });

    it('permits valid data:image/ URIs', () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const dataMedia = createMockMedia({ url: dataUri });
      const { getByRole } = render(<MediaImage media={dataMedia} />);
      const img = getByRole('img');
      expect(img).toHaveAttribute('src', dataUri);
    });

    it('rejects malicious javascript: protocol and falls back to placeholder image', () => {
      const unsafeMedia = createMockMedia({ url: 'javascript:alert("xss")' });
      const { getByRole } = render(<MediaImage media={unsafeMedia} />);
      const img = getByRole('img');
      expect(img).toHaveAttribute('src', '/images/placeholder.png');
    });

    it('rejects file: protocol and falls back to placeholder image', () => {
      const unsafeMedia = createMockMedia({ url: 'file:///etc/passwd' });
      const { getByRole } = render(<MediaImage media={unsafeMedia} />);
      const img = getByRole('img');
      expect(img).toHaveAttribute('src', '/images/placeholder.png');
    });

    it('rejects ftp: protocol and falls back to placeholder image', () => {
      const unsafeMedia = createMockMedia({ url: 'ftp://example.com/image.png' });
      const { getByRole } = render(<MediaImage media={unsafeMedia} />);
      const img = getByRole('img');
      expect(img).toHaveAttribute('src', '/images/placeholder.png');
    });

    it('rejects protocol-relative URLs starting with // and falls back to placeholder image', () => {
      const unsafeMedia = createMockMedia({ url: '//evil.com/phish.png' });
      const { getByRole } = render(<MediaImage media={unsafeMedia} />);
      const img = getByRole('img');
      expect(img).toHaveAttribute('src', '/images/placeholder.png');
    });

    it('rejects backslash path traversal starting with /\\ and falls back to placeholder image', () => {
      const unsafeMedia = createMockMedia({ url: '/\\evil.com/phish.png' });
      const { getByRole } = render(<MediaImage media={unsafeMedia} />);
      const img = getByRole('img');
      expect(img).toHaveAttribute('src', '/images/placeholder.png');
    });
  });

  describe('Broken Image Load Event Handling', () => {
    it('transitions to fallback placeholder image on broken image load event (onError)', () => {
      const media = createMockMedia({ url: 'https://example.com/broken-link.jpg' });
      const { getByRole } = render(<MediaImage media={media} />);
      const img = getByRole('img');

      expect(img).toHaveAttribute('src', 'https://example.com/broken-link.jpg');

      fireEvent.error(img);

      expect(img).toHaveAttribute('src', '/images/placeholder.png');
    });

    it('invokes custom onError callback prop when broken image load occurs', () => {
      const media = createMockMedia({ url: 'https://example.com/failing.jpg' });
      const onErrorMock = jest.fn();
      const { getByRole } = render(<MediaImage media={media} onError={onErrorMock} />);
      const img = getByRole('img');

      fireEvent.error(img);

      expect(onErrorMock).toHaveBeenCalledTimes(1);
      expect(img).toHaveAttribute('src', '/images/placeholder.png');
    });
  });

  describe('Alt Text Mapping & Fallback Behavior', () => {
    it('uses media.altText for non-decorative media', () => {
      const media = createMockMedia({ altText: 'Descriptive Alt Text', isDecorative: false });
      const { getByRole } = render(<MediaImage media={media} />);
      const img = getByRole('img');

      expect(img).toHaveAttribute('alt', 'Descriptive Alt Text');
    });

    it('sets alt="" for decorative media regardless of altText', () => {
      const media = createMockMedia({ altText: 'Ignored Alt Text', isDecorative: true });
      const { container } = render(<MediaImage media={media} />);
      const img = container.querySelector('img');

      expect(img).not.toBeNull();
      expect(img).toHaveAttribute('alt', '');
    });

    it('uses fallbackAlt when media.altText is missing or null on non-decorative media', () => {
      const media = createMockMedia({ altText: null, isDecorative: false });
      const { getByRole } = render(<MediaImage media={media} fallbackAlt="Fallback Alt Text" />);
      const img = getByRole('img');

      expect(img).toHaveAttribute('alt', 'Fallback Alt Text');
    });

    it('uses explicit alt prop when media prop is not provided', () => {
      const { getByRole } = render(<MediaImage src="/images/sample.jpg" alt="Explicit Alt" />);
      expect(getByRole('img')).toHaveAttribute('alt', 'Explicit Alt');
    });

    it('uses fallbackAlt when media prop and alt prop are not provided', () => {
      const { getByRole } = render(<MediaImage src="/images/sample.jpg" fallbackAlt="Fallback Only" />);
      expect(getByRole('img')).toHaveAttribute('alt', 'Fallback Only');
    });
  });

  describe('Automated Accessibility Audits (jest-axe)', () => {
    it('passes accessibility evaluations for standard descriptive image state', async () => {
      const media = createMockMedia({
        url: 'https://example.com/accessible.jpg',
        altText: 'Accessible Wedding Cake',
        isDecorative: false,
      });
      const { container } = render(<MediaImage media={media} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes accessibility evaluations for decorative image state', async () => {
      const media = createMockMedia({
        url: 'https://example.com/decorative-divider.jpg',
        altText: null,
        isDecorative: true,
      });
      const { container } = render(<MediaImage media={media} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes accessibility evaluations for fallback placeholder image state', async () => {
      const media = createMockMedia({ url: 'javascript:unsafe' });
      const { container } = render(<MediaImage media={media} fallbackAlt="Placeholder Image" />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes accessibility evaluations after broken image state transition', async () => {
      const media = createMockMedia({
        url: 'https://example.com/broken.jpg',
        altText: 'Broken Image Test',
      });
      const { container, getByRole } = render(<MediaImage media={media} />);

      fireEvent.error(getByRole('img'));

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
