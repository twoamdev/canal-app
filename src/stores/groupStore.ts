import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Group } from '../types/scene-graph';

// =============================================================================
// Types
// =============================================================================

interface GroupState {
  /** All groups indexed by ID */
  groups: Record<string, Group>;

  // Group CRUD
  addGroup: (group: Group) => void;
  updateGroup: (id: string, updates: Partial<Group>) => void;
  removeGroup: (id: string) => void;

  // Member management
  addMember: (groupId: string, memberId: string) => void;
  removeMember: (groupId: string, memberId: string) => void;
  setMembers: (groupId: string, memberIds: string[]) => void;
  reorderMembers: (groupId: string, fromIndex: number, toIndex: number) => void;

  // Bulk operations
  setGroups: (groups: Record<string, Group>) => void;
  clearGroups: () => void;

  // Getters
  getGroup: (id: string) => Group | undefined;
  getGroupsContainingMember: (memberId: string) => Group[];

  // Utilities
  isGroupId: (id: string) => boolean;
}

// =============================================================================
// Store
// =============================================================================

export const useGroupStore = create<GroupState>()(
  persist(
    (set, get) => ({
      // Initial state
      groups: {},

      // ========================================================================
      // Group CRUD
      // ========================================================================

      addGroup: (group) => {
        set((state) => ({
          groups: {
            ...state.groups,
            [group.id]: group,
          },
        }));
      },

      updateGroup: (id, updates) => {
        set((state) => {
          const existing = state.groups[id];
          if (!existing) {
            console.warn(`[GroupStore] Cannot update non-existent group: ${id}`);
            return state;
          }
          return {
            groups: {
              ...state.groups,
              [id]: { ...existing, ...updates },
            },
          };
        });
      },

      removeGroup: (id) => {
        set((state) => {
          const { [id]: removed, ...rest } = state.groups;
          if (!removed) {
            console.warn(`[GroupStore] Cannot remove non-existent group: ${id}`);
          }
          return { groups: rest };
        });
      },

      // ========================================================================
      // Member Management
      // ========================================================================

      addMember: (groupId, memberId) => {
        set((state) => {
          const group = state.groups[groupId];
          if (!group) {
            console.warn(`[GroupStore] Cannot add member to non-existent group: ${groupId}`);
            return state;
          }
          // Avoid duplicates
          if (group.memberIds.includes(memberId)) {
            return state;
          }
          return {
            groups: {
              ...state.groups,
              [groupId]: {
                ...group,
                memberIds: [...group.memberIds, memberId],
              },
            },
          };
        });
      },

      removeMember: (groupId, memberId) => {
        set((state) => {
          const group = state.groups[groupId];
          if (!group) {
            console.warn(`[GroupStore] Cannot remove member from non-existent group: ${groupId}`);
            return state;
          }
          return {
            groups: {
              ...state.groups,
              [groupId]: {
                ...group,
                memberIds: group.memberIds.filter((id) => id !== memberId),
              },
            },
          };
        });
      },

      setMembers: (groupId, memberIds) => {
        set((state) => {
          const group = state.groups[groupId];
          if (!group) {
            console.warn(`[GroupStore] Cannot set members on non-existent group: ${groupId}`);
            return state;
          }
          return {
            groups: {
              ...state.groups,
              [groupId]: {
                ...group,
                memberIds,
              },
            },
          };
        });
      },

      reorderMembers: (groupId, fromIndex, toIndex) => {
        set((state) => {
          const group = state.groups[groupId];
          if (!group) {
            console.warn(`[GroupStore] Cannot reorder members in non-existent group: ${groupId}`);
            return state;
          }
          const newMemberIds = [...group.memberIds];
          const [removed] = newMemberIds.splice(fromIndex, 1);
          newMemberIds.splice(toIndex, 0, removed);
          return {
            groups: {
              ...state.groups,
              [groupId]: {
                ...group,
                memberIds: newMemberIds,
              },
            },
          };
        });
      },

      // ========================================================================
      // Bulk Operations
      // ========================================================================

      setGroups: (groups) => {
        set({ groups });
      },

      clearGroups: () => {
        set({ groups: {} });
      },

      // ========================================================================
      // Getters
      // ========================================================================

      getGroup: (id) => {
        return get().groups[id];
      },

      getGroupsContainingMember: (memberId) => {
        return Object.values(get().groups).filter((group) =>
          group.memberIds.includes(memberId)
        );
      },

      // ========================================================================
      // Utilities
      // ========================================================================

      isGroupId: (id) => {
        return id in get().groups;
      },
    }),
    {
      name: 'canal-group-storage',
      version: 1,
    }
  )
);

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select all groups as an array
 */
export const selectAllGroups = (): Group[] => {
  return Object.values(useGroupStore.getState().groups);
};

/**
 * Check if an ID refers to a group
 */
export function isGroupId(id: string): boolean {
  return useGroupStore.getState().isGroupId(id);
}
