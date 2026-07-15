'use client';

import React, { useState, useEffect } from 'react';
import WeddingPartyCard from './WeddingPartyCard';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';

interface WeddingPartyListProps {
  members: WeddingPartyMemberDTO[];
}

const WeddingPartyList: React.FC<WeddingPartyListProps> = ({ members: initialMembers }) => {
  const [members, setMembers] = useState(initialMembers);

  useEffect(() => {
    if (typeof window !== 'undefined' && window !== window.parent) {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'DRAFT_UPDATE' && event.data.draftType === 'wedding-party') {
          setMembers(event.data.draftData);
        }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {members.map((member) => (
        <WeddingPartyCard key={member.id} member={member} />
      ))}
    </div>
  );
};

export default WeddingPartyList;
