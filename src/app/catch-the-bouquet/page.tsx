'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Box } from '@react-three/drei';
import { Physics, RigidBody, RapierRigidBody, CuboidCollider, CollisionPayload } from '@react-three/rapier'; // Added CollisionPayload
import * as THREE from 'three';

// --- Constants ---
const PIPE_SPAWN_X = 15; // X position where pipes spawn (off-screen right)
const PIPE_DESPAWN_X = -15; // X position where pipes despawn (off-screen left)
const PIPE_SPEED = 3; // How fast pipes move left
const PIPE_GAP = 3; // Vertical gap between pipes
const PIPE_WIDTH = 1.5;
const PIPE_MIN_HEIGHT = 1;
const PIPE_MAX_HEIGHT = 5;
const SPAWN_INTERVAL = 2; // Seconds between pipe spawns

// --- Pipe Obstacle Component ---
interface PipeProps {
  position: [number, number, number];
  height: number;
  isTopPipe: boolean;
}

function Pipe({ position, height, isTopPipe }: PipeProps) {
  return (
    <RigidBody
      type="kinematicPosition"
      colliders="cuboid"
      position={position}
      name="pipe" // Identify pipes for collision
    >
      <Box args={[PIPE_WIDTH, height, PIPE_WIDTH]} castShadow receiveShadow>
        <meshStandardMaterial color="green" />
      </Box>
    </RigidBody>
  );
}

// --- Score Sensor Component ---
interface ScoreSensorProps {
  position: [number, number, number];
}

function ScoreSensor({ position }: ScoreSensorProps) {
  return (
    <RigidBody
      type="kinematicPosition"
      colliders={false} // No solid collision
      position={position}
      name="scoreSensor" // Identify score sensors
      userData={{ scored: false }} // Track if score was awarded for this gap
    >
      <CuboidCollider args={[PIPE_WIDTH / 2, PIPE_GAP / 2, PIPE_WIDTH / 2]} sensor />
    </RigidBody>
  );
}

// --- Pipe Pair Component ---
interface PipePairProps {
  id: number;
  xPosition: number;
  gapY: number; // Center Y position of the gap
  topPipeHeight: number;
  bottomPipeHeight: number;
  pipeRefMap: React.MutableRefObject<Map<string, RapierRigidBody>>;
}

function PipePair({ id, xPosition, gapY, topPipeHeight, bottomPipeHeight, pipeRefMap }: PipePairProps) {
  const topPipeRef = useRef<RapierRigidBody>(null);
  const bottomPipeRef = useRef<RapierRigidBody>(null);
  const scoreSensorRef = useRef<RapierRigidBody>(null);

  // Store refs in the map for movement updates
  useEffect(() => {
    if (topPipeRef.current) pipeRefMap.current.set(`top_${id}`, topPipeRef.current);
    if (bottomPipeRef.current) pipeRefMap.current.set(`bottom_${id}`, bottomPipeRef.current);
    if (scoreSensorRef.current) pipeRefMap.current.set(`sensor_${id}`, scoreSensorRef.current);
    // Cleanup refs when component unmounts
    return () => {
      pipeRefMap.current.delete(`top_${id}`);
      pipeRefMap.current.delete(`bottom_${id}`);
      pipeRefMap.current.delete(`sensor_${id}`);
    };
  }, [id, pipeRefMap]);

  const topPipeY = gapY + PIPE_GAP / 2 + topPipeHeight / 2;
  const bottomPipeY = gapY - PIPE_GAP / 2 - bottomPipeHeight / 2;

  return (
    <>
      <RigidBody
        ref={topPipeRef}
        type="kinematicPosition"
        colliders="cuboid"
        position={[xPosition, topPipeY, 0]}
        name="pipe"
      >
        <Box args={[PIPE_WIDTH, topPipeHeight, PIPE_WIDTH]} castShadow receiveShadow>
          <meshStandardMaterial color="green" />
        </Box>
      </RigidBody>
      <RigidBody
        ref={bottomPipeRef}
        type="kinematicPosition"
        colliders="cuboid"
        position={[xPosition, bottomPipeY, 0]}
        name="pipe"
      >
        <Box args={[PIPE_WIDTH, bottomPipeHeight, PIPE_WIDTH]} castShadow receiveShadow>
          <meshStandardMaterial color="green" />
        </Box>
      </RigidBody>
      <RigidBody
        ref={scoreSensorRef}
        type="kinematicPosition"
        colliders={false} // No solid collision
        position={[xPosition, gapY, 0]}
        name="scoreSensor"
        userData={{ scored: false }} // Track if score was awarded
      >
        <CuboidCollider args={[PIPE_WIDTH / 2, PIPE_GAP / 2, PIPE_WIDTH / 2]} sensor />
      </RigidBody>
    </>
  );
}

interface GameCanvasProps {
  setScore: React.Dispatch<React.SetStateAction<number>>;
  onGameOver: () => void;
  isGameOver: boolean;
  resetSignal: number;
}

// Define the type for the exposed handle
export interface GameCanvasHandle {
  handleJump: () => void;
}

// Wrap GameCanvas with forwardRef
const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(
  ({ setScore, onGameOver, isGameOver, resetSignal }, ref) => {
    const birdRef = useRef<RapierRigidBody>(null);
    const [pipes, setPipes] = useState<PipeState[]>([]);
    const nextPipeId = useRef(0);
    const timeSinceLastSpawn = useRef(0);
    const pipeRefMap = useRef<Map<string, RapierRigidBody>>(new Map());

    // --- Reset Logic ---
    useEffect(() => {
      if (resetSignal > 0) { // Trigger on signal change (initial 0)
        // Reset bird position and velocity
        if (birdRef.current) {
          birdRef.current.setTranslation({ x: 0, y: 1, z: 0 }, true);
          birdRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          birdRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        // Clear existing pipes and reset counters
        setPipes([]);
        pipeRefMap.current.clear();
        nextPipeId.current = 0;
        timeSinceLastSpawn.current = 0;
      }
    }, [resetSignal]); // Depend on the reset signal

    const handleJump = useCallback(() => {
      if (birdRef.current && !isGameOver) {
        birdRef.current.setLinvel({ x: 0, y: 6, z: 0 }, true);
      }
    }, [isGameOver]);

    // Expose handleJump via useImperativeHandle
    useImperativeHandle(ref, () => ({
      handleJump,
    }));

    const spawnPipe = useCallback(() => {
      const id = nextPipeId.current++;
      const gapY = Math.random() * 4 - 2; // Random gap center (-2 to +2)
      const topHeight = PIPE_MIN_HEIGHT + Math.random() * (PIPE_MAX_HEIGHT - PIPE_MIN_HEIGHT);
      // Calculate bottom height based on available space (adjust based on your ground/ceiling)
      const bottomHeight = Math.max(PIPE_MIN_HEIGHT, 8 - topHeight - PIPE_GAP); // Example calculation

      setPipes((prevPipes) => [
        ...prevPipes,
        {
          id,
          xPosition: PIPE_SPAWN_X,
          gapY,
          topPipeHeight: topHeight,
          bottomPipeHeight: bottomHeight,
        },
      ]);
    }, []);

    useFrame((state, delta) => {
      // Stop updates if game is over OR if it hasn't started (pipes empty implies reset state)
      if (isGameOver || pipes.length === 0 && timeSinceLastSpawn.current === 0) {
          // If game just ended, ensure bird stops moving immediately
          if (isGameOver && birdRef.current) {
               birdRef.current.setLinvel({ x: 0, y: birdRef.current.linvel().y, z: 0 }, true); // Stop horizontal movement
          }
          return;
      }

      // --- Bird out of bounds check ---
      if (birdRef.current) {
        const pos = birdRef.current.translation();
        if (pos.y < -6 || pos.y > 8) {
          if (!isGameOver) onGameOver();
          return; // Stop frame processing if game over
        }
      }

      // --- Pipe Spawning ---
      timeSinceLastSpawn.current += delta;
      if (timeSinceLastSpawn.current >= SPAWN_INTERVAL) {
        spawnPipe();
        timeSinceLastSpawn.current = 0;
      }

      // --- Pipe Movement & Despawning ---
      const newPipes: PipeState[] = [];
      const currentPipeRefs = pipeRefMap.current;

      for (const pipe of pipes) {
        const newX = pipe.xPosition - PIPE_SPEED * delta;

        // Move kinematic bodies
        const topPipeBody = currentPipeRefs.get(`top_${pipe.id}`);
        const bottomPipeBody = currentPipeRefs.get(`bottom_${pipe.id}`);
        const scoreSensorBody = currentPipeRefs.get(`sensor_${pipe.id}`);

        if (topPipeBody) {
          const currentPos = topPipeBody.translation();
          topPipeBody.setNextKinematicTranslation({ x: newX, y: currentPos.y, z: currentPos.z });
        }
        if (bottomPipeBody) {
          const currentPos = bottomPipeBody.translation();
          bottomPipeBody.setNextKinematicTranslation({ x: newX, y: currentPos.y, z: currentPos.z });
        }
        if (scoreSensorBody) {
          const currentPos = scoreSensorBody.translation();
          scoreSensorBody.setNextKinematicTranslation({ x: newX, y: currentPos.y, z: currentPos.z });
        }

        // Keep pipe if not off-screen left
        if (newX > PIPE_DESPAWN_X) {
          newPipes.push({ ...pipe, xPosition: newX });
        } else {
           // Clean up refs for despawned pipes
           pipeRefMap.current.delete(`top_${pipe.id}`);
           pipeRefMap.current.delete(`bottom_${pipe.id}`);
           pipeRefMap.current.delete(`sensor_${pipe.id}`);
        }
      }
      setPipes(newPipes);
    });

    // Typed the payload parameter
    const handleCollision = useCallback((payload: CollisionPayload) => {
      if (isGameOver) return;

      // Access rigidBodyObject from the correct place
      const objectName = payload.other.rigidBodyObject?.name;

      if (objectName === 'pipe') {
        console.log("Collision with: Pipe");
        onGameOver();
      } else if (objectName === 'scoreSensor') {
        const sensorBody = payload.other.rigidBody;
        // Check userData correctly
        if (sensorBody && typeof sensorBody.userData === 'object' &&
            sensorBody.userData !== null && 'scored' in sensorBody.userData && !sensorBody.userData.scored) {
          console.log("Collision with: Score Sensor");
          setScore(prev => prev + 1);
          sensorBody.userData.scored = true; // Mark as scored
        }
      }
    }, [isGameOver, onGameOver, setScore]);

    // Remove the outer div, return Physics directly
    return (
      <Physics gravity={[0, -9.81, 0]}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 10, 5]} intensity={1.5} castShadow />

        {/* Player Bird */}
        <RigidBody
          ref={birdRef}
          colliders="cuboid"
          position={[0, 1, 0]}
          linearDamping={0.5}
          angularDamping={0.5}
          canSleep={false}
          onCollisionEnter={handleCollision} // Correct prop name and single handler
          name="bird"
        >
          <Box args={[0.5, 0.5, 0.5]} castShadow receiveShadow>
            <meshStandardMaterial color="yellow" />
          </Box>
        </RigidBody>

        {/* Render Pipes - Added type to map parameter and corrected props */}
        {pipes.map((pipe: PipeState) => (
          <PipePair
            key={pipe.id}
            id={pipe.id}
            xPosition={pipe.xPosition}
            gapY={pipe.gapY}
            topPipeHeight={pipe.topPipeHeight}
            bottomPipeHeight={pipe.bottomPipeHeight}
            pipeRefMap={pipeRefMap}
          />
        ))}

        <OrbitControls enabled={false} />
      </Physics>
    );
  }
);

// Add display name for debugging
GameCanvas.displayName = 'GameCanvas';

// --- PipeState interface ---
interface PipeState {
  id: number;
  xPosition: number;
  gapY: number;
  topPipeHeight: number;
  bottomPipeHeight: number;
}

export default function FlappyBirdPage() {
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<'playing' | 'gameOver' | 'initial'>('initial');
  const [resetSignal, setResetSignal] = useState(0);
  const gameCanvasRef = useRef<GameCanvasHandle>(null); // Create ref for GameCanvas

  useEffect(() => {
    // Removed timer logic
  }, [gameState]); // Dependency array updated

  const startGame = () => {
    setScore(0);
    setGameState('playing');
    setResetSignal(prev => prev + 1);
  };

  const handleGameOver = useCallback(() => {
    setGameState('gameOver');
  }, []);

  const isGameOver = gameState === 'gameOver';

  // Define the click handler here, calling the exposed function via ref
  const handleCanvasClick = () => {
    if (gameState === 'playing') {
      gameCanvasRef.current?.handleJump();
    } else if (gameState === 'initial') {
        startGame(); // Allow starting game by clicking canvas initially
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gradient-to-br from-sky-200 to-blue-300">
      <h1 className="text-4xl font-bold mb-4 text-orange-600">Flappy Bird Clone!</h1>

      {gameState === 'initial' && !isGameOver && ( // Show button only initially if not game over
        <button
          onClick={startGame}
          className="px-6 py-3 bg-green-500 text-white rounded-lg text-xl font-semibold hover:bg-green-600 transition duration-200 mb-4"
        >
          Start Game
        </button>
      )}

      {(gameState === 'playing' || gameState === 'gameOver') && (
        <>
          <div className="flex space-x-6 mb-4 text-lg font-medium text-gray-700">
            <span>Score: {score}</span>
          </div>

          <div className="w-full max-w-md h-[600px] border-4 border-gray-400 rounded-lg overflow-hidden bg-sky-100 shadow-lg relative">
            {isGameOver && (
              <div className="absolute inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center z-10">
                <h2 className="text-5xl font-bold text-white mb-4">Game Over!</h2>
                <p className="text-2xl text-white mb-6">Your Score: {score}</p>
                <button
                  onClick={startGame}
                  className="px-6 py-3 bg-green-500 text-white rounded-lg text-xl font-semibold hover:bg-green-600 transition duration-200"
                >
                  Play Again?
                </button>
              </div>
            )}
            <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-500">Loading 3D Scene...</div>}> 
              {/* Add onClick to Canvas and pass the ref */}
              <Canvas
                shadows
                camera={{ position: [0, 0, 8], fov: 60 }}
                onClick={handleCanvasClick} // Attach click handler here
                style={{ cursor: 'pointer' }} // Add pointer cursor to canvas
              >
                <GameCanvas
                  ref={gameCanvasRef} // Pass the ref here
                  setScore={setScore}
                  onGameOver={handleGameOver}
                  isGameOver={isGameOver}
                  resetSignal={resetSignal}
                />
              </Canvas>
            </Suspense>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            {gameState !== 'gameOver' ? 'Click anywhere to make the bird flap!' : 'Game Over!'}
          </p>
        </>
      )}
    </div>
  );
}
