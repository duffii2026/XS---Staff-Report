import { useEffect, useState } from 'react';
import {
  getDepartments,
  getPositions,
  isOrgConfigLoaded,
  subscribeOrgConfig
} from '../services/storage';

export interface OrgConfigState {
  /** Active department names, in the backend's alphabetical order. */
  departments: string[];
  /** Active position / job title names. */
  positions: string[];
  /** False until the master lists have been fetched at least once. */
  loaded: boolean;
}

/**
 * Live view of the admin-managed Departments & Positions master lists.
 *
 * The lists are owned by the backend (`org_config` table) and cached in the
 * storage layer, so components must subscribe rather than read once — an admin
 * adding a department in another tab should update every open dropdown.
 *
 * Falls back to the hardcoded defaults while `loaded` is false, so a failed
 * fetch or a missing migration never empties a dropdown.
 */
export function useOrgConfig(): OrgConfigState {
  const [, setVersion] = useState(0);

  useEffect(() => subscribeOrgConfig(() => setVersion((v) => v + 1)), []);

  return {
    departments: getDepartments(),
    positions: getPositions(),
    loaded: isOrgConfigLoaded()
  };
}
