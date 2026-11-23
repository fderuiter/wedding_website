'use client';

import React, { useState, useEffect } from 'react';
import WeddingPartyCard from './WeddingPartyCard';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { cn } from '@/utils/cn';
import { useStaticDemoPageOverrides } from '@/lib/staticDemo/runtime';

interface WeddingPartyListProps {
  members: WeddingPartyMemberDTO[];
  partner1Name?: string;
  partner2Name?: string;
}

type TabFilter = 'ALL' | 'BRIDE' | 'GROOM' | 'JOINT';

const WeddingPartyList: React.FC<WeddingPartyListProps> = ({
  members: initialMembers,
  partner1Name,
  partner2Name,
}) => {
  const demo = useOptionalDemo();
  const demoOverrides = useStaticDemoPageOverrides();
  const baseMembers = demoOverrides?.weddingParty ?? initialMembers;
  const [draftOverride, setDraftOverride] = useState<{
    base: WeddingPartyMemberDTO[];
    members: WeddingPartyMemberDTO[];
  } | null>(null);
  const [activeTab, setActiveTab] = useState<TabFilter>('ALL');

  const members = demo?.isDemoMode
    ? demo.activeDataset.weddingParty
    : draftOverride && draftOverride.base === initialMembers
      ? draftOverride.members
      : baseMembers;

  useEffect(() => {
    if (typeof window !== 'undefined' && window !== window.parent) {
      const handleMessage = (event: MessageEvent) => {
        if (
          event.data?.type === 'DRAFT_UPDATE' &&
          event.data.draftType === 'wedding-party' &&
          Array.isArray(event.data.draftData)
        ) {
          setDraftOverride({
            base: initialMembers,
            members: event.data.draftData,
          });
        }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, [initialMembers]);

  const effectivePartner1Name = demo?.isDemoMode
    ? demo.configOverrides.partner1Name || partner1Name
    : demoOverrides?.config.partner1Name || partner1Name;
  const effectivePartner2Name = demo?.isDemoMode
    ? demo.configOverrides.partner2Name || partner2Name
    : demoOverrides?.config.partner2Name || partner2Name;
  const p1 = effectivePartner1Name?.trim() || '';
  const p2 = effectivePartner2Name?.trim() || '';
  const partner1SideLabel = p1 ? `${p1}'s Side` : "Partner 1's Side";
  const partner2SideLabel = p2 ? `${p2}'s Side` : "Partner 2's Side";

  const candidateSideTabs: { id: Exclude<TabFilter, 'ALL'>; label: string; count: number }[] = [
    {
      id: 'BRIDE',
      label: partner1SideLabel,
      count: members.filter((m) => m.side === 'BRIDE').length,
    },
    {
      id: 'GROOM',
      label: partner2SideLabel,
      count: members.filter((m) => m.side === 'GROOM').length,
    },
    {
      id: 'JOINT',
      label: 'Joint',
      count: members.filter((m) => m.side === 'JOINT').length,
    },
  ];

  const populatedSideTabs = candidateSideTabs.filter((tab) => tab.count > 0);
  const showTabBar = populatedSideTabs.length >= 2;
  const visibleTabs: { id: TabFilter; label: string }[] = showTabBar
    ? [{ id: 'ALL', label: 'All' }, ...populatedSideTabs.map(({ id, label }) => ({ id, label }))]
    : [];

  const resolvedActiveTab: TabFilter =
    showTabBar && visibleTabs.some((tab) => tab.id === activeTab) ? activeTab : 'ALL';

  const filteredMembers = members.filter((member) => {
    if (resolvedActiveTab === 'ALL') return true;
    return member.side === resolvedActiveTab;
  });

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (visibleTabs.length === 0) return;
    let nextIndex = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (index + 1) % visibleTabs.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = visibleTabs.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    setActiveTab(visibleTabs[nextIndex].id);
    const btn = document.getElementById(`tab-${visibleTabs[nextIndex].id.toLowerCase()}`);
    btn?.focus();
  };

  const gridContent =
    filteredMembers.length > 0 ? (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredMembers.map((member) => (
          <WeddingPartyCard key={member.id} member={member} />
        ))}
      </div>
    ) : (
      <div className="text-center py-12 text-gray-600 dark:text-gray-300">
        No wedding party members found for this side.
      </div>
    );

  return (
    <div className="space-y-8">
      {showTabBar ? (
        <>
          <div
            role="tablist"
            aria-label="Wedding Party Filter"
            className="flex flex-wrap justify-center gap-2 mb-8"
          >
            {visibleTabs.map((tab, idx) => {
              const isActive = resolvedActiveTab === tab.id;
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
            aria-labelledby={`tab-${resolvedActiveTab.toLowerCase()}`}
          >
            {gridContent}
          </div>
        </>
      ) : (
        <div>{gridContent}</div>
      )}
    </div>
  );
};

export default WeddingPartyList;
