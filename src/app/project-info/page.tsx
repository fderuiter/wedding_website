import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import ProjectInfoClient from './ProjectInfoClient';

export const metadata: Metadata = createPageMetadata({
  title: 'About This Project',
  description: 'Overview of the wedding website architecture, features, and open-source technology stack.',
  canonical: '/project-info',
});

export default function ProjectInfoPage() {
  return <ProjectInfoClient />;
}
