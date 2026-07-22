import { render } from '@testing-library/react';
import { Overlay } from '../Overlay';
test('Overlay renders without crashing', () => {
  render(<Overlay isOpen={true} onClose={() => {}}>Content</Overlay>);
});
