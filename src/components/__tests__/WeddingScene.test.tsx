import React from 'react';
import { render } from '@testing-library/react';
import WeddingScene, { createEngravingTextures, EngravedRing, WeddingModel } from '../WeddingScene';
import { Physics } from '@react-three/rapier';

describe('WeddingScene', () => {
  beforeAll(() => {
    global.ResizeObserver =
      global.ResizeObserver ||
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    // Mock canvas getContext for jsdom with all required properties (no duplicate setLineDash)
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
      canvas: document.createElement('canvas'),
      fillRect: jest.fn(),
      fillStyle: '',
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
      fillText: jest.fn(),
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      clearRect: jest.fn(),
      measureText: jest.fn(() => ({ width: 100 })),
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      arc: jest.fn(),
      closePath: jest.fn(),
      stroke: jest.fn(),
      clip: jest.fn(),
      drawImage: jest.fn(),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
      createPattern: jest.fn(),
      createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
      getImageData: jest.fn(),
      putImageData: jest.fn(),
      getLineDash: jest.fn(() => []),
      lineDashOffset: 0,
      miterLimit: 10,
      lineCap: 'butt',
      lineJoin: 'miter',
      lineWidth: 1,
      strokeStyle: '',
      setTransform: jest.fn(),
      resetTransform: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      scale: jest.fn(),
      transform: jest.fn(),
      direction: 'inherit',
      // Add any other required stubs here
    }) as any);
  });

  it('renders without crashing', () => {
    render(<WeddingScene />);
  });

  it('createEngravingTextures returns nulls if window is undefined', () => {
    const originalWindow = global.window;
    // @ts-ignore
    delete global.window;
    const result = createEngravingTextures('test');
    expect(result).toEqual({ map: null, normalMap: null, bumpMap: null });
    global.window = originalWindow;
  });

  it('createEngravingTextures returns nulls if context is missing', () => {
    // Mock document.createElement to return an object with no getContext
    const origCreateElement = document.createElement;
    document.createElement = () => ({ getContext: () => null }) as any;
    const result = createEngravingTextures('test');
    expect(result).toEqual({ map: null, normalMap: null, bumpMap: null });
    document.createElement = origCreateElement;
  });

  it('createEngravingTextures works for partialEngraving true', () => {
    const result = createEngravingTextures('test', true, 0.2, 0.8);
    expect(result.map).toBeDefined();
    expect(result.normalMap).toBeDefined();
    expect(result.bumpMap).toBeDefined();
  });

  it('createEngravingTextures works for partialEngraving false', () => {
    const result = createEngravingTextures('test', false);
    expect(result.map).toBeDefined();
    expect(result.normalMap).toBeDefined();
    expect(result.bumpMap).toBeDefined();
  });

  it('EngravedRing renders with various props inside Physics', () => {
    render(
      <Physics>
        <EngravedRing
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          outerRadius={1}
          innerRadius={0.8}
          height={0.2}
          color="#FFD700"
          text="Sample"
        />
      </Physics>
    );
    render(
      <Physics>
        <EngravedRing
          position={[1, 1, 1]}
          rotation={[1, 1, 1]}
          outerRadius={2}
          innerRadius={1.5}
          height={0.5}
          color="#C0C0C0"
          text=""
        />
      </Physics>
    );
  });

  it('WeddingModel renders inside Physics', () => {
    render(
      <Physics>
        <WeddingModel />
      </Physics>
    );
  });
});
