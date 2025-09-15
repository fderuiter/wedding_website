'use client';

import { useState, useEffect } from 'react';
import { checkAdminClient } from '@/utils/adminAuth.client';

/**
 * A hook to determine if the current user has admin privileges.
 * It checks the admin status on mount and provides a boolean state.
 *
 * @returns {boolean} `true` if the user is an admin, otherwise `false`.
 */
export function useAdminStatus(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkStatus = async () => {
      const adminStatus = await checkAdminClient();
      setIsAdmin(adminStatus);
    };
    checkStatus();
  }, []);

  return isAdmin;
}
