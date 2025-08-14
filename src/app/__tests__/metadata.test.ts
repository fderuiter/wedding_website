import { metadata } from '../metadata';

describe('metadata', () => {
  it('matches expected values', () => {
    expect(metadata.title).toBe("Abbigayle & Frederick's Wedding");
    expect(metadata.description).toBe(
      'A joyful celebration of love uniting Abbigayle & Frederick in historic Plummer House gardens.'
    );
    expect(metadata.icons).toEqual({ icon: '/assets/favicon.png' });
    expect(metadata.openGraph).toEqual({
      type: 'website',
      url: 'https://abbifred.com/',
      title: "Abbigayle & Frederick's Wedding",
      description:
        'A joyful celebration of love uniting Abbigayle & Frederick in historic Plummer House gardens.',
      images: ['https://abbifred.com/assets/favicon.png'],
    });
    expect(metadata.twitter).toEqual({
      card: 'summary',
      title: "Abbigayle & Frederick's Wedding",
      description:
        'A joyful celebration of love uniting Abbigayle & Frederick in historic Plummer House gardens.',
      images: ['https://abbifred.com/assets/favicon.png'],
    });
    expect(metadata.metadataBase?.href).toBe('https://abbifred.com/');
  });
});
