import React from 'react';
import { render } from '@testing-library/react';
import WeddingScene from '../WeddingScene';

describe('WeddingScene', () => {
  beforeAll(() => {
    global.ResizeObserver =
      global.ResizeObserver ||
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  });

  it('renders without crashing', () => {
    render(<WeddingScene />);
  });
});
