import { render } from '@testing-library/react';
import { FormGroup, Label, Input } from '../forms';
test('Form components render without crashing', () => {
  render(
    <FormGroup>
      <Label>Label</Label>
      <Input />
    </FormGroup>
  );
});
