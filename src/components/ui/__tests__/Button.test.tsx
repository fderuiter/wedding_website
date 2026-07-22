import { render } from '@testing-library/react';
import { Button } from '../Button';
test('Button renders without crashing', () => {
  render(<Button>Click me</Button>);
});
