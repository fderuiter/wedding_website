import React from 'react';
import Image from 'next/image';
import { WeddingPartyMember } from '@/data/wedding-party';
import { ExternalLink } from 'lucide-react';

/**
 * @interface WeddingPartyCardProps
 * @description Defines the props for the WeddingPartyCard component.
 * @property {WeddingPartyMember} member - The wedding party member's data to display.
 */
interface WeddingPartyCardProps {
  member: WeddingPartyMember;
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
        <Image
          src={member.photo}
          alt={`Photo of ${member.name}`}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          style={{ objectFit: 'cover' }}
          className="rounded-t-lg"
        />
      </div>
      <div className="p-6">
        <h3 className="text-2xl font-bold text-rose-700 dark:text-rose-400 mb-2">{member.name}</h3>
        <p className="text-lg font-medium text-gray-600 dark:text-gray-300 mb-4">{member.role}</p>
        <p className="text-base text-gray-700 dark:text-gray-400 mb-4">{member.bio}</p>
        {member.link && (
          <a
            href={member.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-200"
          >
            Learn more <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
};

export default WeddingPartyCard;
