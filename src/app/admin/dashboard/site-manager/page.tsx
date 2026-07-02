"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { FormGroup, Label, Input, Textarea } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/ToastProvider";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useAdminFeatures } from "@/hooks/admin/useAdminFeatures";

export default function SiteManagerPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { features, loading, error, saveFeatures } = useAdminFeatures();
  
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customContent, setCustomContent] = useState("");

  const toggleVisibility = (id: string) => {
    const updated = features.map(f => f.id === id ? { ...f, visible: !f.visible } : f);
    saveFeatures(updated).then(() => addToast('Section visibility updated', 'success'));
  };

  const addCustomSection = () => {
    if (!customTitle.trim() || !customContent.trim()) {
      addToast("Title and content are required.", 'error');
      return;
    }
    const newId = 'custom-' + Date.now();
    const newFeature = {
      id: newId,
      type: 'custom',
      title: customTitle,
      content: customContent,
      visible: true
    };
    const updated = [...features, newFeature];
    saveFeatures(updated).then(() => addToast('Section added', 'success'));
    setShowCustomModal(false);
    setCustomTitle("");
    setCustomContent("");
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

  if (loading) return <div className="p-8 text-center text-primary">Loading Site Manager...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;

  return (
    <div className="py-10">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-extrabold text-primary tracking-tight">Visual Site Manager</h1>
          <div className="space-x-4">
            <Button onClick={() => setShowCustomModal(true)} variant="secondary">Add Custom Section</Button>
          </div>
        </div>

        <p className="mb-6 text-lg text-gray-700 dark:text-gray-300">
          Drag and drop sections to reorder them on the homepage. Toggle the eye icon to show or hide a section. Use Tab to navigate and Space/Enter to select and move items.
        </p>

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
                        className={`p-4 rounded-xl shadow border border-primary dark:border-primary flex justify-between items-center bg-white dark:bg-gray-800 transition ${!feature.visible ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center gap-4">
                          <div className="text-gray-500 dark:text-gray-400">
                            <Icon name="DragHandle" className="h-6 w-6" />
                          </div>
                          <div>
                            <h3 className="font-bold text-xl text-primary">{feature.title || feature.id}</h3>
                            <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{feature.type}</span>
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
                            className={`px-4 py-2 rounded text-sm font-bold ${feature.visible ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'}`}
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

        <Dialog
          isOpen={showCustomModal}
          onClose={() => setShowCustomModal(false)}
          title="Add Custom Section"
          aria-labelledby="modal-title"
          className="dark:bg-gray-800"
        >
          <div className="space-y-4">
            <FormGroup>
              <Label>Section Title</Label>
              <Input type="text" value={customTitle} onChange={e => setCustomTitle(e.target.value)} placeholder="e.g. Health & Safety" />
            </FormGroup>
            <FormGroup>
              <Label>Content</Label>
              <Textarea value={customContent} onChange={e => setCustomContent(e.target.value)} rows={5} placeholder="Add your content here... Use double line breaks for paragraphs." />
            </FormGroup>
            <div className="flex gap-4 mt-6">
              <Button onClick={addCustomSection} className="flex-1 bg-green-600 hover:bg-green-700">Save Section</Button>
              <Button onClick={() => setShowCustomModal(false)} variant="ghost" className="flex-1">Cancel</Button>
            </div>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
