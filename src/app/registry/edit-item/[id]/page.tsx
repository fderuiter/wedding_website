import { EditItemPage } from '@/features/registry';

export function generateStaticParams() {
  return [{ id: '1' }];
}

export default function Page() {
  return <EditItemPage />;
}
