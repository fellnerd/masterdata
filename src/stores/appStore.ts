import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Types
export interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'approver' | 'editor' | 'viewer'
}

export interface AppSettings {
  theme: 'light' | 'dark'
  sidebarCollapsed: boolean
  pageSize: number
  autoRefresh: boolean
  autoRefreshInterval: number // seconds
}

interface AppState {
  // User
  user: User | null
  setUser: (user: User | null) => void
  
  // Settings
  settings: AppSettings
  updateSettings: (settings: Partial<AppSettings>) => void
  
  // UI State
  isLoading: boolean
  setLoading: (loading: boolean) => void
  
  // Current selection context
  selectedModelId: string | null
  setSelectedModelId: (id: string | null) => void
  selectedEntityId: string | null
  setSelectedEntityId: (id: string | null) => void
  
  // Notifications
  notifications: Notification[]
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void
  removeNotification: (id: string) => void
  clearNotifications: () => void
}

interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  timestamp: Date
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  sidebarCollapsed: false,
  pageSize: 50,
  autoRefresh: true,
  autoRefreshInterval: 30,
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // User
      user: {
        id: 'user-001',
        name: 'Admin',
        email: 'admin@example.com',
        role: 'admin',
      },
      setUser: (user) => set({ user }),
      
      // Settings
      settings: defaultSettings,
      updateSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings }
      })),
      
      // UI State
      isLoading: false,
      setLoading: (isLoading) => set({ isLoading }),
      
      // Current selection
      selectedModelId: null,
      setSelectedModelId: (selectedModelId) => set({ selectedModelId }),
      selectedEntityId: null,
      setSelectedEntityId: (selectedEntityId) => set({ selectedEntityId }),
      
      // Notifications
      notifications: [],
      addNotification: (notification) => {
        const newNotification: Notification = {
          ...notification,
          id: `notif-${Date.now()}`,
          timestamp: new Date(),
        }
        set((state) => ({
          notifications: [...state.notifications, newNotification]
        }))
        
        // Auto-remove after 5 seconds for success/info
        if (notification.type === 'success' || notification.type === 'info') {
          setTimeout(() => {
            get().removeNotification(newNotification.id)
          }, 5000)
        }
      },
      removeNotification: (id) => set((state) => ({
        notifications: state.notifications.filter(n => n.id !== id)
      })),
      clearNotifications: () => set({ notifications: [] }),
    }),
    {
      name: 'mds-app-storage',
      partialize: (state) => ({
        settings: state.settings,
        selectedModelId: state.selectedModelId,
      }),
    }
  )
)
