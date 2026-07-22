import { render } from '@testing-library/react';
import { Icon } from '../Icon';
test('Icon renders without crashing', () => {
  render(<Icon name="X" />);
});
