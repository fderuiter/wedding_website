import { cn } from '../cn';
test('cn combines classes', () => {
  expect(cn('a', 'b')).toContain('a');
});
