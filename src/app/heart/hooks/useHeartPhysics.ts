import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ContactForcePayload } from '@react-three/rapier';
import { RigidBodyType } from '@dimforge/rapier3d-compat';
import { RapierRigidBody } from '@react-three/rapier';
import { PHYSICS_CONSTANTS } from '../constants';

const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();
const tempVector = new THREE.Vector3();

interface UseHeartPhysicsProps {
  mainRbRef: React.RefObject<RapierRigidBody>
  leftRbRef: React.RefObject<RapierRigidBody>
  rightRbRef: React.RefObject<RapierRigidBody>
  groupRef: React.RefObject<THREE.Group>
  isBroken: boolean
  reduceMotion: boolean
  interacted: boolean
  viewportWidth: number
  viewportHeight: number
  pulseSpeed: number
  breakHeart: () => void
  setShowEasterEgg: (show: boolean) => void
}

export function useHeartPhysics({
  mainRbRef,
  leftRbRef,
  rightRbRef,
  groupRef,
  isBroken,
  reduceMotion,
  interacted,
  viewportWidth,
  viewportHeight,
  pulseSpeed,
  breakHeart,
  setShowEasterEgg
}: UseHeartPhysicsProps) {

  const wasInSecretSpot = useRef(false);

  const handleContactForce = (payload: ContactForcePayload) => {
    if (!isBroken && payload.totalForceMagnitude > PHYSICS_CONSTANTS.BREAK_FORCE_THRESHOLD) {
      breakHeart();
    }
  };

  useEffect(() => {
    const mainRb = mainRbRef.current;
    const leftRb = leftRbRef.current;
    const rightRb = rightRbRef.current;

    if (!mainRb || !leftRb || !rightRb) {
      return;
    }

    if (isBroken) {
      // Heart just broke
      const position = mainRb.translation();
      const rotation = mainRb.rotation();
      const linvel = mainRb.linvel();
      const angvel = mainRb.angvel();

      // Disable main heart physics (not just hide visually)
      mainRb.setEnabled(false);

      // Enable broken pieces physics
      leftRb.setEnabled(true);
      leftRb.setBodyType(RigidBodyType.Dynamic, true);
      rightRb.setEnabled(true);
      rightRb.setBodyType(RigidBodyType.Dynamic, true);

      leftRb.setTranslation(position, true);
      leftRb.setRotation(rotation, true);
      leftRb.setLinvel(linvel, true);
      leftRb.setAngvel(angvel, true);

      rightRb.setTranslation(position, true);
      rightRb.setRotation(rotation, true);
      rightRb.setLinvel(linvel, true);
      rightRb.setAngvel(angvel, true);

      // Apply explosion
      if (!reduceMotion) {
        leftRb.applyImpulse(PHYSICS_CONSTANTS.EXPLOSION_IMPULSE_LEFT, true);
        rightRb.applyImpulse(PHYSICS_CONSTANTS.EXPLOSION_IMPULSE_RIGHT, true);

        const torqueStrength = PHYSICS_CONSTANTS.EXPLOSION_TORQUE_STRENGTH;
        const leftTorque = {
          x: (Math.random() - 0.5) * torqueStrength,
          y: (Math.random() - 0.5) * torqueStrength,
          z: (Math.random() - 0.5) * torqueStrength,
        };
        const rightTorque = {
          x: (Math.random() - 0.5) * torqueStrength,
          y: (Math.random() - 0.5) * torqueStrength,
          z: (Math.random() - 0.5) * torqueStrength,
        };
        leftRb.applyTorqueImpulse(leftTorque, true);
        rightRb.applyTorqueImpulse(rightTorque, true);
      }

    } else {
      // Heart is reforming - reset shard physics completely
      leftRb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      leftRb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      leftRb.setTranslation({ x: 0, y: 0, z: 0 }, true);
      leftRb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      leftRb.setBodyType(RigidBodyType.Fixed, true);
      leftRb.setEnabled(false);

      rightRb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rightRb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      rightRb.setTranslation({ x: 0, y: 0, z: 0 }, true);
      rightRb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      rightRb.setBodyType(RigidBodyType.Fixed, true);
      rightRb.setEnabled(false);

      // Re-enable main heart
      mainRb.setEnabled(true);
      mainRb.setBodyType(RigidBodyType.Dynamic, true);
      mainRb.setTranslation({ x: 0, y: 0, z: 0 }, true);
      mainRb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      mainRb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }, [isBroken, reduceMotion, mainRbRef, leftRbRef, rightRbRef]);

  useFrame((state) => {
    if (mainRbRef.current && !isBroken) {
      const position = mainRbRef.current.translation();

      // Easter egg logic
      const secretSpotX = viewportWidth / 2 - 2;
      const secretSpotY = viewportHeight / 2 - 2;
      const isInSecretSpot = position.x > secretSpotX && position.y > secretSpotY;
      if (isInSecretSpot !== wasInSecretSpot.current) {
        wasInSecretSpot.current = isInSecretSpot;
        setShowEasterEgg(isInSecretSpot);
      }

      if (!interacted) {
        if (!reduceMotion) {
          const rotation = mainRbRef.current.rotation();
          if (typeof tempQuaternion.set === 'function') {
            tempQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
          } else {
            tempQuaternion.x = rotation.x;
            tempQuaternion.y = rotation.y;
            tempQuaternion.z = rotation.z;
            tempQuaternion.w = rotation.w;
          }
          if (typeof tempEuler.setFromQuaternion === 'function') {
            tempEuler.setFromQuaternion(tempQuaternion);
          }
          tempEuler.y += PHYSICS_CONSTANTS.IDLE_ROTATION_SPEED;
          if (typeof tempQuaternion.setFromEuler === 'function') {
            tempQuaternion.setFromEuler(tempEuler);
          }
          mainRbRef.current.setRotation(tempQuaternion, true);
        }
      } else {
        const distance = Math.sqrt(position.x ** 2 + position.y ** 2);
        if (distance > 0.1) {
          if (!reduceMotion) {
            if (typeof tempVector.set === 'function') {
              tempVector.set(-position.x, -position.y, 0);
            } else {
              tempVector.x = -position.x;
              tempVector.y = -position.y;
              tempVector.z = 0;
            }
            if (typeof tempVector.normalize === 'function') {
              tempVector.normalize();
            }
            if (typeof tempVector.multiplyScalar === 'function') {
              tempVector.multiplyScalar(PHYSICS_CONSTANTS.RETURN_FORCE_MULTIPLIER);
            }
            mainRbRef.current.addForce(tempVector, true);
          } else {
            mainRbRef.current.setTranslation({ x: 0, y: 0, z: position.z }, true);
            mainRbRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
        } else {
          mainRbRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }

    if (!reduceMotion) {
      const t = state.clock.getElapsedTime();
      const pulseScale = 1 + Math.sin(t * pulseSpeed) * PHYSICS_CONSTANTS.PULSE_SCALE_MULTIPLIER;
      if (groupRef.current) {
        groupRef.current.scale.set(pulseScale, pulseScale, pulseScale);
      }
    } else {
      if (groupRef.current) {
        groupRef.current.scale.set(1, 1, 1);
      }
    }
  });

  return { handleContactForce };
}
