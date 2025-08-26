import React from 'react';
import Image from 'next/image';
import { WeddingPartyMember } from '@/data/wedding-party';
import { ExternalLink } from 'lucide-react';

interface WeddingPartyCardProps {
  member: WeddingPartyMember;
}

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
