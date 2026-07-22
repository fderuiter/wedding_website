import { render } from '@testing-library/react';
import { Skeleton } from '../Skeleton';
test('Skeleton renders without crashing', () => {
  render(<Skeleton />);
});
