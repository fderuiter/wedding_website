import { Metadata } from 'next';
import ProjectInfoClient from './ProjectInfoClient';

export const metadata: Metadata = {
  title: 'Project Info',
  description: 'Learn about the technology and architecture behind this open-source wedding website.',
  alternates: {
    canonical: '/project-info',
  },
};

/**
 * @page ProjectInfo
 * @description The server component wrapper for the project info page.
 * It defines the metadata for SEO and renders the client-side ProjectInfoClient.
 *
 * @returns {JSX.Element} The rendered project info page.
 */
export default function ProjectInfo() {
  return <ProjectInfoClient />;
}
