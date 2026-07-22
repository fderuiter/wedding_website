import { render } from '@testing-library/react';
import { Dialog } from '../Dialog';
test('Dialog renders without crashing', () => {
  render(<Dialog isOpen={true} onClose={() => {}}>Content</Dialog>);
});
