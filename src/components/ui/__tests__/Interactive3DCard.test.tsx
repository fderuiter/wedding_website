import { render } from '@testing-library/react';
import { Interactive3DCard } from '../Interactive3DCard';
test('Interactive3DCard renders without crashing', () => {
  render(<Interactive3DCard>Content</Interactive3DCard>);
});
