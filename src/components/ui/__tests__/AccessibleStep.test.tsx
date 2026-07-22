import { render } from '@testing-library/react';
import { AccessibleStep } from '../AccessibleStep';
test('AccessibleStep renders without crashing', () => {
  render(<AccessibleStep isActive={true}>Content</AccessibleStep>);
});
