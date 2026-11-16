import React, { Suspense } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Heart3D } from './Heart3D';

function WebGLMockCanvasContainer({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: '700px',
        height: '450px',
        margin: '0 auto',
        background: 'radial-gradient(circle at center, #1f2937, #111827)',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 7.5], fov: 45 }}
        gl={{ localClippingEnabled: true, antialias: true }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[10, 10, 10]} intensity={1.8} />
        <directionalLight position={[-10, -5, -5]} intensity={0.8} />
        <directionalLight position={[0, -10, 5]} intensity={0.5} />
        <Suspense fallback={null}>
          {children}
        </Suspense>
        <OrbitControls enableZoom={true} enablePan={false} autoRotate autoRotateSpeed={1.5} />
      </Canvas>
    </div>
  );
}

const meta: Meta<typeof Heart3D> = {
  title: 'Visual & Graphical/Heart3D',
  component: Heart3D,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <WebGLMockCanvasContainer>
        <Story />
      </WebGLMockCanvasContainer>
    ),
  ],
  argTypes: {
    scale: { control: { type: 'range', min: 0.5, max: 2, step: 0.1 } },
    primaryColor: { control: 'color' },
    secondaryColor: { control: 'color' },
    partner1Name: { control: 'text' },
    partner2Name: { control: 'text' },
    shardSide: {
      control: 'select',
      options: [undefined, 'left', 'right'],
    },
  },
  args: {
    scale: 1,
    primaryColor: '#B91C1C',
    secondaryColor: '#D4AF37',
    partner1Name: 'Alex',
    partner2Name: 'Jordan',
  },
};

export default meta;
type Story = StoryObj<typeof Heart3D>;

export const FullHeart: Story = {
  args: {
    scale: 1,
    primaryColor: '#B91C1C',
    secondaryColor: '#D4AF37',
    partner1Name: 'Alex',
    partner2Name: 'Jordan',
  },
};

export const LeftShard: Story = {
  args: {
    scale: 1,
    primaryColor: '#B91C1C',
    secondaryColor: '#D4AF37',
    partner1Name: 'Alex',
    partner2Name: 'Jordan',
    shardSide: 'left',
  },
};

export const RightShard: Story = {
  args: {
    scale: 1,
    primaryColor: '#B91C1C',
    secondaryColor: '#D4AF37',
    partner1Name: 'Alex',
    partner2Name: 'Jordan',
    shardSide: 'right',
  },
};

export const CustomColors: Story = {
  args: {
    scale: 1.2,
    primaryColor: '#2563EB',
    secondaryColor: '#9333EA',
    partner1Name: 'Morgan',
    partner2Name: 'Taylor',
  },
};
