import React from 'react';
import { MediaImage } from '@/components/MediaImage';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import { Icon } from '@/components/ui/Icon';

/**
 * @interface WeddingPartyCardProps
 * @description Defines the props for the WeddingPartyCard component.
 * @property {WeddingPartyMemberDTO} member - The wedding party member's data to display.
 */
interface WeddingPartyCardProps {
  member: WeddingPartyMemberDTO;
}

/**
 * @function WeddingPartyCard
 * @description A React component that displays a card for a member of the wedding party.
 * It includes the member's photo, name, role, biography, and an optional link.
 * @param {WeddingPartyCardProps} props - The props for the component.
 * @returns {JSX.Element} The rendered WeddingPartyCard component.
 */
const WeddingPartyCard: React.FC<WeddingPartyCardProps> = ({ member }) => {
  return (
    <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden transform transition-transform hover:scale-105">
      <div className="relative h-64 w-full">
        <MediaImage
          media={member.photo}
          fallbackUrl="/images/placeholder.png"
          fallbackAlt={`Photo of ${member.name}`}
          className="rounded-t-lg w-full h-full object-cover"
        />
      </div>
      <div className="p-6">
        <h3 className="text-2xl font-bold text-primary dark:text-primary mb-2">{member.name}</h3>
        <p className="text-lg font-medium text-gray-600 dark:text-gray-300 mb-4">{member.role}</p>
        <p className="text-base text-gray-700 dark:text-gray-400 mb-4">{member.bio}</p>
        {member.link && (
          <a
            href={member.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-primary dark:text-primary hover:text-primary dark:hover:text-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-label={`Learn more about ${member.name}`}
          >
            Learn more <Icon name="ExternalLink" className="ml-2 h-4 w-4" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
};

export default WeddingPartyCard;
