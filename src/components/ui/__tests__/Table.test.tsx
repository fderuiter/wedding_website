import { render } from '@testing-library/react';
import { Table, TableBody, TableCell, TableRow } from '../Table';
test('Table renders without crashing', () => {
  render(<Table><TableBody><TableRow><TableCell>Cell</TableCell></TableRow></TableBody></Table>);
});
