'use client';

import React from 'react';
import { weddingPartyMembers } from '@/data/wedding-party';
import WeddingPartyCard from './WeddingPartyCard';

const WeddingPartyList: React.FC = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {weddingPartyMembers.map((member) => (
        <WeddingPartyCard key={member.name} member={member} />
      ))}
    </div>
  );
};

export default WeddingPartyList;
