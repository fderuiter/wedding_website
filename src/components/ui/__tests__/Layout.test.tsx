import { render } from '@testing-library/react';
import { Container, Card, Heading } from '../Layout';
test('Layout components render without crashing', () => {
  render(
    <Container>
      <Card>
        <Heading>Content</Heading>
      </Card>
    </Container>
  );
});
