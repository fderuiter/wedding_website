'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
// Import other necessary components for the game later

// Placeholder for the actual game component
function GameCanvas() {
  // Game logic will go here: spawning bouquets, handling clicks, score, timer, etc.
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      {/* Add game elements here - e.g., bouquets, catcher area */}
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="orange" />
      </mesh>
      <OrbitControls />
    </>
  );
}

export default function CatchTheBouquetPage() {
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60); // Example timer
  const [lives, setLives] = useState(3); // Example lives

  // Basic timer logic (example)
  useEffect(() => {
    if (timeLeft <= 0) return; // Stop timer when it reaches 0
    const timerId = setInterval(() => {
      setTimeLeft(timeLeft - 1);
    }, 1000);
    return () => clearInterval(timerId);
  }, [timeLeft]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-4xl font-bold mb-4">Catch the Bouquet!</h1>
      <div className="flex space-x-4 mb-4">
        <span>Score: {score}</span>
        <span>Time Left: {timeLeft}</span>
        <span>Lives: {lives}</span>
      </div>
      <div className="w-full max-w-4xl h-[600px] border rounded-lg overflow-hidden bg-gray-200">
        <Suspense fallback={<div>Loading Game...</div>}>
          <Canvas>
            <GameCanvas />
          </Canvas>
        </Suspense>
      </div>
      <p className="mt-4 text-sm text-gray-600">Click or tap the bouquets to catch them!</p>
      {/* Add instructions or other UI elements as needed */}
    </div>
  );
}
