'use client';

import React from 'react';
import WeddingPartyCard from './WeddingPartyCard';
import { WeddingPartyMember } from '@prisma/client';

interface WeddingPartyListProps {
  members: WeddingPartyMember[];
}

/**
 * @function WeddingPartyList
 * @description A React component that displays a grid of WeddingPartyCard components.
 * It maps over the `weddingPartyMembers` data to render a card for each member.
 * @returns {JSX.Element} The rendered WeddingPartyList component.
 */
const WeddingPartyList: React.FC<WeddingPartyListProps> = ({ members }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {members.map((member) => (
        <WeddingPartyCard key={member.id} member={member} />
      ))}
    </div>
  );
};

export default WeddingPartyList;
