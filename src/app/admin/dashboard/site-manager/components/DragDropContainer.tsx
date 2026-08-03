'use client';

import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';

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
}

export default function DragDropContainer({
  features,
  saveFeatures,
  toggleVisibility,
}: DragDropContainerProps) {
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
                    {...provided.dragHandleProps}
                    className={`p-4 rounded-xl shadow border border-primary dark:border-primary flex justify-between items-center bg-white dark:bg-gray-800 transition ${
                      !feature.visible ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="text-gray-500 dark:text-gray-400">
                        <Icon name="DragHandle" className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="font-bold text-xl text-primary">
                          {feature.title || feature.id}
                        </h3>
                        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          {feature.type}
                        </span>
                      </div>
                    </div>
                    <div>
                      <Button
                        type="button"
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
  );
}
