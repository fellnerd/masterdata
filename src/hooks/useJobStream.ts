import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface StreamMessage {
  type: 'log' | 'progress' | 'completed' | 'failed' | 'status' | 'init' | 'heartbeat';
  message?: string;
  progress?: number;
  percent?: number;
  logs?: string[];
  result?: unknown;
  error?: string;
  state?: string;
  timestamp?: string;
}

export interface JobStreamState {
  logs: string[];
  progress: number;
  status: 'connecting' | 'connected' | 'completed' | 'failed' | 'disconnected';
  error: string | null;
  lastUpdate: Date | null;
}

/**
 * Hook to subscribe to real-time job updates via SSE
 * 
 * @param jobId - The job ID to subscribe to
 * @param enabled - Whether to enable the subscription
 * @returns Job stream state with logs, progress, and status
 */
export function useJobStream(jobId: string | null, enabled: boolean = true) {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  
  const [state, setState] = useState<JobStreamState>({
    logs: [],
    progress: 0,
    status: 'disconnected',
    error: null,
    lastUpdate: null,
  });

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setState(prev => ({
      ...prev,
      status: 'disconnected',
    }));
  }, []);

  const connect = useCallback(() => {
    if (!jobId || !enabled) {
      return;
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setState(prev => ({
      ...prev,
      status: 'connecting',
      error: null,
    }));

    const eventSource = new EventSource(`/api/jobs/${jobId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setState(prev => ({
        ...prev,
        status: 'connected',
      }));
    };

    eventSource.onmessage = (event) => {
      try {
        const data: StreamMessage = JSON.parse(event.data);
        
        setState(prev => {
          const newState = { ...prev, lastUpdate: new Date() };
          
          // Handle progress/percent from different formats
          const progressValue = data.progress ?? data.percent;

          switch (data.type) {
            case 'init':
              // Initial state from server
              if (typeof progressValue === 'number') {
                newState.progress = progressValue;
              }
              if (Array.isArray(data.logs) && data.logs.length > 0) {
                newState.logs = [...prev.logs, ...data.logs];
              }
              break;

            case 'log':
              if (data.message) {
                newState.logs = [...prev.logs, data.message];
              }
              break;

            case 'progress':
              if (typeof progressValue === 'number') {
                newState.progress = progressValue;
              }
              if (data.message) {
                newState.logs = [...prev.logs, data.message];
              }
              // Also add any logs array
              if (Array.isArray(data.logs) && data.logs.length > 0) {
                newState.logs = [...prev.logs, ...data.logs];
              }
              break;

            case 'status':
              if (typeof progressValue === 'number') {
                newState.progress = progressValue;
              }
              if (data.message) {
                newState.logs = [...prev.logs, data.message];
              }
              break;

            case 'completed':
              newState.status = 'completed';
              newState.progress = 100;
              if (data.message) {
                newState.logs = [...prev.logs, data.message];
              } else {
                newState.logs = [...prev.logs, '✓ Job completed successfully'];
              }
              // Invalidate queries to refresh job list
              queryClient.invalidateQueries({ queryKey: ['jobs'] });
              break;

            case 'failed':
              newState.status = 'failed';
              newState.error = data.error || 'Job failed';
              if (data.error) {
                newState.logs = [...prev.logs, `✗ Error: ${data.error}`];
              }
              // Invalidate queries to refresh job list
              queryClient.invalidateQueries({ queryKey: ['jobs'] });
              break;
          }

          return newState;
        });

        // Close connection if job is finished
        if (data.type === 'completed' || data.type === 'failed') {
          eventSource.close();
          eventSourceRef.current = null;
        }
      } catch (err) {
        console.error('[JobStream] Failed to parse message:', err);
      }
    };

    eventSource.onerror = () => {
      // EventSource will automatically reconnect on transient errors
      // Only update state if we're not already disconnected
      setState(prev => {
        if (prev.status === 'disconnected') return prev;
        return {
          ...prev,
          status: 'disconnected',
          error: 'Connection lost',
        };
      });
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [jobId, enabled, queryClient]);

  // Connect/disconnect based on enabled state and jobId
  useEffect(() => {
    if (enabled && jobId) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [jobId, enabled, connect, disconnect]);

  // Clear logs helper
  const clearLogs = useCallback(() => {
    setState(prev => ({
      ...prev,
      logs: [],
    }));
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    clearLogs,
    isConnected: state.status === 'connected',
    isFinished: state.status === 'completed' || state.status === 'failed',
  };
}

/**
 * Hook to manage multiple job streams at once
 * Useful for the jobs page to track all running jobs
 */
export function useMultipleJobStreams(jobIds: string[]) {
  const [streams, setStreams] = useState<Map<string, JobStreamState>>(new Map());
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const queryClient = useQueryClient();

  useEffect(() => {
    const currentSources = eventSourcesRef.current;
    
    // Remove streams for jobs that are no longer in the list
    const toRemove: string[] = [];
    currentSources.forEach((_, id) => {
      if (!jobIds.includes(id)) {
        toRemove.push(id);
      }
    });
    
    toRemove.forEach(id => {
      currentSources.get(id)?.close();
      currentSources.delete(id);
    });

    // Add streams for new jobs
    jobIds.forEach(jobId => {
      if (currentSources.has(jobId)) return;

      const eventSource = new EventSource(`/api/jobs/${jobId}/stream`);
      currentSources.set(jobId, eventSource);

      // Initialize state
      setStreams(prev => {
        const next = new Map(prev);
        next.set(jobId, {
          logs: [],
          progress: 0,
          status: 'connecting',
          error: null,
          lastUpdate: null,
        });
        return next;
      });

      eventSource.onopen = () => {
        setStreams(prev => {
          const next = new Map(prev);
          const existing = next.get(jobId);
          if (existing) {
            next.set(jobId, { ...existing, status: 'connected' });
          }
          return next;
        });
      };

      eventSource.onmessage = (event) => {
        try {
          const data: StreamMessage = JSON.parse(event.data);
          
          setStreams(prev => {
            const next = new Map(prev);
            const existing = next.get(jobId) || {
              logs: [],
              progress: 0,
              status: 'connected' as const,
              error: null,
              lastUpdate: null,
            };

            const updated = { ...existing, lastUpdate: new Date() };
            
            // Handle progress/percent from different formats
            const progressValue = data.progress ?? data.percent;

            switch (data.type) {
              case 'init':
                // Initial state from server
                if (typeof progressValue === 'number') {
                  updated.progress = progressValue;
                }
                if (Array.isArray(data.logs) && data.logs.length > 0) {
                  updated.logs = [...existing.logs, ...data.logs];
                }
                break;

              case 'log':
                if (data.message) {
                  updated.logs = [...existing.logs, data.message];
                }
                break;

              case 'progress':
                if (typeof progressValue === 'number') {
                  updated.progress = progressValue;
                }
                if (data.message) {
                  updated.logs = [...existing.logs, data.message];
                }
                // Also add any logs array
                if (Array.isArray(data.logs) && data.logs.length > 0) {
                  updated.logs = [...existing.logs, ...data.logs];
                }
                break;

              case 'status':
                if (typeof progressValue === 'number') {
                  updated.progress = progressValue;
                }
                break;

              case 'completed':
                updated.status = 'completed';
                updated.progress = 100;
                updated.logs = [...existing.logs, '✓ Job completed'];
                queryClient.invalidateQueries({ queryKey: ['jobs'] });
                break;

              case 'failed':
                updated.status = 'failed';
                updated.error = data.error || 'Job failed';
                queryClient.invalidateQueries({ queryKey: ['jobs'] });
                break;
            }

            next.set(jobId, updated);
            return next;
          });

          // Close connection if job is finished
          if (data.type === 'completed' || data.type === 'failed') {
            eventSource.close();
            currentSources.delete(jobId);
          }
        } catch (err) {
          console.error('[MultiJobStream] Failed to parse message:', err);
        }
      };

      eventSource.onerror = () => {
        setStreams(prev => {
          const next = new Map(prev);
          const existing = next.get(jobId);
          if (existing) {
            next.set(jobId, { ...existing, status: 'disconnected', error: 'Connection lost' });
          }
          return next;
        });
      };
    });

    // Cleanup on unmount
    return () => {
      currentSources.forEach(source => source.close());
      currentSources.clear();
    };
  }, [jobIds, queryClient]);

  return streams;
}
