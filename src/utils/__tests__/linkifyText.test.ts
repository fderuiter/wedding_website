import { tokenizeSafeLinks } from '../linkifyText';

describe('tokenizeSafeLinks', () => {
  it('returns an empty array for null, undefined, or empty strings', () => {
    expect(tokenizeSafeLinks(undefined)).toEqual([]);
    expect(tokenizeSafeLinks(null)).toEqual([]);
    expect(tokenizeSafeLinks('')).toEqual([]);
  });

  it('linkifies https, http, mailto, bare email, tel, formatted phone numbers, internal paths, and markdown links', () => {
    const input =
      'Book your room at https://hotel.example.com/block, view our [Wedding Registry](/registry), check #accommodations, email hosts@example.org or mailto:rsvp@example.org, or call +1 (555) 234-5678 / tel:+15559876543.';
    const tokens = tokenizeSafeLinks(input);
    const links = tokens.filter((t) => t.type === 'link');

    expect(links).toEqual([
      {
        type: 'link',
        label: 'https://hotel.example.com/block',
        href: 'https://hotel.example.com/block',
        isExternal: true,
      },
      {
        type: 'link',
        label: 'Wedding Registry',
        href: '/registry',
        isExternal: false,
      },
      {
        type: 'link',
        label: '#accommodations',
        href: '#accommodations',
        isExternal: false,
      },
      {
        type: 'link',
        label: 'hosts@example.org',
        href: 'mailto:hosts@example.org',
        isExternal: false,
      },
      {
        type: 'link',
        label: 'rsvp@example.org',
        href: 'mailto:rsvp@example.org',
        isExternal: false,
      },
      {
        type: 'link',
        label: '+1 (555) 234-5678',
        href: 'tel:+15552345678',
        isExternal: false,
      },
      {
        type: 'link',
        label: '+15559876543',
        href: 'tel:+15559876543',
        isExternal: false,
      },
    ]);
  });

  it('preserves trailing sentence punctuation outside link hrefs', () => {
    const tokens = tokenizeSafeLinks(
      'Visit /things-to-do, or browse (https://travel.example.com/guide).'
    );
    expect(tokens).toEqual([
      { type: 'text', value: 'Visit ' },
      { type: 'link', label: '/things-to-do', href: '/things-to-do', isExternal: false },
      { type: 'text', value: ', or browse (' },
      {
        type: 'link',
        label: 'https://travel.example.com/guide',
        href: 'https://travel.example.com/guide',
        isExternal: true,
      },
      { type: 'text', value: ').' },
    ]);
  });

  it('strips raw HTML tags, scripts, protocol-relative URLs, and unsafe URI schemes without executing XSS', () => {
    const malicious =
      '<script>alert("xss")</script>Click [Evil JS](javascript:alert(1)) or [Data URI](data:text/html,<script>alert(2)</script>) or [Protocol Relative](//evil.example.com) or <img src="x" onerror="alert(3)"> or <a href="javascript:alert(4)">Unsafe Anchor</a> or <a href="https://safe.example.com">Safe Anchor</a> vbscript:msgbox(1)';
    const tokens = tokenizeSafeLinks(malicious);

    const serialized = JSON.stringify(tokens);
    expect(serialized).not.toContain('<script');
    expect(serialized).not.toContain('<img');
    expect(serialized).not.toContain('javascript:');
    expect(serialized).not.toContain('data:');
    expect(serialized).not.toContain('vbscript:');
    expect(serialized).not.toContain('//evil.example.com');

    const links = tokens.filter((t) => t.type === 'link');
    expect(links).toEqual([
      {
        type: 'link',
        label: 'Safe Anchor',
        href: 'https://safe.example.com',
        isExternal: true,
      },
    ]);

    const plainText = tokens.map((t) => (t.type === 'text' ? t.value : t.label)).join('');
    expect(plainText).toContain('Evil JS');
    expect(plainText).toContain('Unsafe Anchor');
  });
});
