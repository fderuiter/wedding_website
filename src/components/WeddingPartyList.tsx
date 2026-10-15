'use client';

import React, { useState, useEffect } from 'react';
import WeddingPartyCard from './WeddingPartyCard';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import { cn } from '@/utils/cn';

interface WeddingPartyListProps {
  members: WeddingPartyMemberDTO[];
}

type TabFilter = 'ALL' | 'BRIDE' | 'GROOM' | 'JOINT';

const TABS: { id: TabFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'BRIDE', label: "Bride's Side" },
  { id: 'GROOM', label: "Groom's Side" },
  { id: 'JOINT', label: 'Joint' },
];

const WeddingPartyList: React.FC<WeddingPartyListProps> = ({ members: initialMembers }) => {
  const [members, setMembers] = useState(initialMembers);
  const [activeTab, setActiveTab] = useState<TabFilter>('ALL');

  useEffect(() => {
    setMembers(initialMembers);
  }, [initialMembers]);

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

  const filteredMembers = members.filter((member) => {
    if (activeTab === 'ALL') return true;
    return member.side === activeTab;
  });

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = index;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % TABS.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = TABS.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    setActiveTab(TABS[nextIndex].id);
    const btn = document.getElementById(`tab-${TABS[nextIndex].id.toLowerCase()}`);
    btn?.focus();
  };

  return (
    <div className="space-y-8">
      <div
        role="tablist"
        aria-label="Wedding Party Filter"
        className="flex flex-wrap justify-center gap-2 mb-8"
      >
        {TABS.map((tab, idx) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id.toLowerCase()}`}
              role="tab"
              aria-selected={isActive}
              aria-controls="wedding-party-tabpanel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={cn(
                'px-4 py-2 rounded-full font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                isActive
                  ? 'bg-primary text-white shadow'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="wedding-party-tabpanel"
        aria-labelledby={`tab-${activeTab.toLowerCase()}`}
      >
        {filteredMembers.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredMembers.map((member) => (
              <WeddingPartyCard key={member.id} member={member} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No wedding party members found for this side.
          </div>
        )}
      </div>
    </div>
  );
};

export default WeddingPartyList;
