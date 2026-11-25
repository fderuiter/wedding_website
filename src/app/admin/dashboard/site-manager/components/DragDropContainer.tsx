'use client';

import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Heading, type HeadingLevel } from '@/components/ui/Layout';

export interface Feature {
  id: string;
  type: string;
  title: string;
  visible: boolean;
  content?: string;
}

interface DragDropContainerProps {
  features: Feature[];
  saveFeatures: (updated: Feature[]) => Promise<any>;
  toggleVisibility: (id: string) => void;
  onDeleteSection?: (id: string) => void;
  headingLevel?: HeadingLevel;
}

export default function DragDropContainer({
  features,
  saveFeatures,
  toggleVisibility,
  onDeleteSection,
  headingLevel = 'h2',
}: DragDropContainerProps) {
  const [announcement, setAnnouncement] = useState<string>('');

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= features.length) return;

    const newFeatures = Array.from(features);
    const [movedItem] = newFeatures.splice(index, 1);
    newFeatures.splice(targetIndex, 0, movedItem);

    saveFeatures(newFeatures);
    setAnnouncement(
      `Moved ${movedItem.title || movedItem.id} ${direction} to position ${targetIndex + 1} of ${features.length}`
    );
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const dragIndex = result.source.index;
    const dropIndex = result.destination.index;

    if (dragIndex === dropIndex) return;

    const newFeatures = Array.from(features);
    const [draggedItem] = newFeatures.splice(dragIndex, 1);
    newFeatures.splice(dropIndex, 0, draggedItem);

    saveFeatures(newFeatures);
  };

  return (
    <>
      <div aria-live="polite" className="sr-only" role="status">
        {announcement}
      </div>
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="features-list">
          {(provided) => (
            <div
              {...provided.droppableProps}
              ref={provided.innerRef}
              className="space-y-4"
            >
              {features.map((feature, index) => (
                <Draggable key={feature.id} draggableId={feature.id} index={index}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className={`p-4 rounded-xl shadow border border-primary dark:border-primary flex flex-wrap justify-between items-center gap-3 bg-white dark:bg-gray-800 transition ${
                        !feature.visible ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <div
                          {...provided.dragHandleProps}
                          aria-label={`Reorder ${feature.title || feature.id}`}
                          className="shrink-0 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded p-1 transition-colors"
                        >
                          <Icon name="DragHandle" className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                          <Heading
                            as={headingLevel}
                            variant="none"
                            unstyledColor
                            className="font-bold text-xl text-primary break-words"
                          >
                            {feature.title || feature.id}
                          </Heading>
                          <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {feature.type}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Move ${feature.title || feature.id} up`}
                          disabled={index === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveItem(index, 'up');
                          }}
                        >
                          <Icon name="ArrowUp" className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Move ${feature.title || feature.id} down`}
                          disabled={index === features.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveItem(index, 'down');
                          }}
                        >
                          <Icon name="ArrowDown" className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          pressed={feature.visible}
                          aria-label={`${feature.title || feature.id}: ${feature.visible ? 'Visible' : 'Hidden'}`}
                          onClick={(e) => {
                            // Stop propagation so it doesn't trigger drag
                            e.stopPropagation();
                            toggleVisibility(feature.id);
                          }}
                          variant={feature.visible ? 'outline' : 'ghost'}
                          className={`px-4 py-2 rounded text-sm font-bold ${
                            feature.visible
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                          }`}
                        >
                          {feature.visible ? 'Visible' : 'Hidden'}
                        </Button>
                        {feature.type === 'custom' && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            aria-label={`Delete ${feature.title || feature.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onDeleteSection) {
                                onDeleteSection(feature.id);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </>
  );
}
