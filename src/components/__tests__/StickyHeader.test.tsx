import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import StickyHeader from '../StickyHeader';

describe('StickyHeader', () => {
  let intersectionCallback: IntersectionObserverCallback;

  beforeEach(() => {
    (globalThis as unknown as {
      IntersectionObserver: typeof IntersectionObserver;
    }).IntersectionObserver = jest.fn((cb: IntersectionObserverCallback) => {
      intersectionCallback = cb;
      return {
        observe: jest.fn(),
        disconnect: jest.fn(),
        unobserve: jest.fn(),
      } as unknown as IntersectionObserver;
    });
  });

  it('activates nav link when its section intersects', () => {
    render(
      <>
        <StickyHeader />
        <main>
          <section id="details">Details</section>
          <section id="travel">Travel</section>
          <section id="faq">FAQ</section>
          <section id="registry">Registry</section>
        </main>
      </>
    );

    const travelSection = document.getElementById('travel')!;
    act(() => {
      intersectionCallback([
        { target: travelSection, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ]);
    });

    const travelLink = screen.getByRole('link', { name: 'Travel' });
    expect(travelLink).toHaveClass('bg-black/10', 'dark:bg-white/10');
    expect(screen.getByRole('link', { name: 'Details' })).not.toHaveClass('bg-black/10');

    const faqSection = document.getElementById('faq')!;
    act(() => {
      intersectionCallback([
        { target: faqSection, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ]);
    });

    const faqLink = screen.getByRole('link', { name: 'FAQ' });
    expect(faqLink).toHaveClass('bg-black/10', 'dark:bg-white/10');
    expect(travelLink).not.toHaveClass('bg-black/10');
  });

  it('places skip link as the first tabbable element', () => {
    render(
      <>
        <StickyHeader />
        <main>
          <section id="details">Details</section>
        </main>
      </>
    );

    const skipLink = screen.getByRole('link', { name: 'Skip to content' });
    const focusable = document.body.querySelectorAll(
      'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    expect(focusable[0]).toBe(skipLink);
  });
});

