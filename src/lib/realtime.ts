import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface RoomCallbacks {
  onActivationChange?: (activation: any) => void;
  onPlayerChange?: (players: any[]) => void;
  onPollVoteChange?: (votes: any) => void;
  onError?: (error: any) => void;
}

export function subscribeToRoomUpdates(roomId: string, callbacks: RoomCallbacks) {
  const channels: RealtimeChannel[] = [];
  
  try {
    console.log(`Setting up realtime subscriptions for room ${roomId}`);
    
    // Subscribe to game session changes
    const gameChannel = supabase.channel('game_session_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'game_sessions',
        filter: `room_id=eq.${roomId}`
      }, async (payload) => {
        console.log('Game session change detected:', payload);
        
        if (payload.new?.current_activation !== payload.old?.current_activation) {
          try {
            if (payload.new?.current_activation) {
              // Fetch the full activation details
              const { data: activation, error } = await supabase
                .from('activations')
                .select('*')
                .eq('id', payload.new.current_activation)
                .single();

              if (error) {
                console.error('Error fetching activation:', error);
                callbacks.onError?.(error);
                return;
              }
              
              console.log('New activation loaded:', activation);
              callbacks.onActivationChange?.(activation);
            } else {
              console.log('Clearing current activation');
              callbacks.onActivationChange?.(null);
            }
          } catch (error) {
            console.error('Error fetching activation:', error);
            callbacks.onError?.(error);
          }
        }
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to game session changes for room ${roomId}`);
        }
        if (err) {
          console.error(`Error subscribing to game session changes: ${err}`);
          callbacks.onError?.(err);
        }
      });

    channels.push(gameChannel);

    // Subscribe to player changes
    const playerChannel = supabase.channel(`players_${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'players',
        filter: `room_id=eq.${roomId}`
      }, async () => {
        try {
          const { data, error } = await supabase
            .from('players')
            .select('id, name, score, room_id, stats')
            .eq('room_id', roomId)
            .order('score', { ascending: false });

          if (error) {
            console.error('Error fetching players:', error);
            callbacks.onError?.(error);
            return;
          }

          console.log('Player update received, fetched players:', data?.length);
          callbacks.onPlayerChange?.(data || []);
        } catch (error) {
          console.error('Error fetching players:', error);
          callbacks.onError?.(error);
        }
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to player changes for room ${roomId}`);
        }
        if (err) {
          console.error(`Error subscribing to player changes: ${err}`);
          callbacks.onError?.(err);
        }
      });

    channels.push(playerChannel);

    // Subscribe to activation updates for poll state changes
    const activationUpdatesChannel = supabase.channel(`activation_updates_${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'activations',
        filter: `room_id=eq.${roomId} AND is_template=eq.false`
      }, async (payload) => {
        // Check if this is the current activation in the game session
        const { data: session } = await supabase
          .from('game_sessions')
          .select('current_activation')
          .eq('room_id', roomId)
          .maybeSingle();
            
        if (session?.current_activation === payload.new.id) {
          console.log('Current activation updated:', payload.new);
          callbacks.onActivationChange?.(payload.new);
        }
      })
      .subscribe();

    channels.push(activationUpdatesChannel);

    // Fetch initial state
    const fetchInitialState = async () => {
      try {
        console.log('Fetching initial state for room:', roomId);
        
        // Get current game session and activation
        const { data: session, error: sessionError } = await supabase
          .from('game_sessions')
          .select('current_activation')
          .eq('room_id', roomId)
          .maybeSingle();

        if (sessionError) {
          console.error('Error fetching game session:', sessionError);
          callbacks.onError?.(sessionError);
          return;
        }

        if (session?.current_activation) {
          const { data: activation, error: activationError } = await supabase
            .from('activations')
            .select('*')
            .eq('id', session.current_activation)
            .single();

          if (activationError) {
            console.error('Error fetching activation:', activationError);
            callbacks.onError?.(activationError);
            return;
          }

          if (activation) {
            console.log('Initial activation loaded:', activation);
            callbacks.onActivationChange?.(activation);
          }
        } else {
          console.log('No active session or activation found');
          callbacks.onActivationChange?.(null);
        }

        // Get current players
        const { data: players, error: playersError } = await supabase
          .from('players')
          .select('id, name, score, room_id, stats')
          .eq('room_id', roomId)
          .order('score', { ascending: false });

        if (playersError) {
          console.error('Error fetching players:', playersError);
          callbacks.onError?.(playersError);
          return;
        }

        console.log('Initial players loaded:', players?.length);
        callbacks.onPlayerChange?.(players || []);
      } catch (error) {
        console.error('Error fetching initial state:', error);
        callbacks.onError?.(error);
      }
    };

    // Fetch initial state with retry logic
    const fetchWithRetry = async (retries = 3, delay = 1000) => {
      try {
        await fetchInitialState();
      } catch (error) {
        if (retries > 0) {
          console.log(`Retrying initial state fetch. Retries left: ${retries}`);
          setTimeout(() => fetchWithRetry(retries - 1, delay * 2), delay);
        } else {
          console.error('Failed to fetch initial state after retries');
          callbacks.onError?.(error);
        }
      }
    };

    fetchWithRetry();

    // Return cleanup function
    return () => {
      console.log('Cleaning up subscriptions');
      channels.forEach(channel => {
        console.log('Unsubscribing from channel:', channel.topic);
        try {
          channel.unsubscribe();
        } catch (e) {
          console.error('Error unsubscribing from channel:', e);
        }
      });
    };
  } catch (error) {
    console.error('Error setting up subscriptions:', error);
    callbacks.onError?.(error);
    return () => {
      channels.forEach(channel => {
        try {
          channel.unsubscribe();
        } catch (e) {
          console.error('Error unsubscribing from channel:', e);
        }
      });
    };
  }
}

export function subscribeToPollVotes(
  activationId: string, 
  onVotesUpdate: (votes: Record<string, number>) => void,
  onPollStateChange?: (state: string) => void
): () => void {
  console.log(`Setting up poll vote subscription for activation ${activationId}`);
  
  // Initial votes fetch from database - use direct fetch for reliability
  const fetchInitialVotes = async () => {
    try {
      console.log(`Fetching initial poll votes from database for ${activationId}`);
      
      // First get the activation to get the options
      const { data: activation, error: actError } = await supabase
        .from('activations')
        .select('options')
        .eq('id', activationId)
        .single();
      
      if (actError) {
        console.error('Error fetching activation options:', actError);
        return;
      }
      
      // Initialize votes object with zeros for all options
      const votes: Record<string, number> = {};
      if (activation?.options) {
        activation.options.forEach((option: any) => {
          votes[option.text] = 0;
        });
      }
      
      // Get all votes from the poll_votes table
      const { data, error } = await supabase
        .from('poll_votes')
        .select('answer')
        .eq('activation_id', activationId);
        
      if (error) {
        console.error('Error fetching poll votes from poll_votes:', error);
        
        // Fall back to analytics_events
        const { data: legacyData, error: legacyError } = await supabase
          .from('analytics_events')
          .select('event_data')
          .eq('event_type', 'poll_vote')
          .eq('activation_id', activationId);
          
        if (legacyError) {
          console.error('Error fetching legacy poll votes:', legacyError);
          return;
        }
        
        // Count votes from legacy data
        if (legacyData && legacyData.length > 0) {
          legacyData.forEach(event => {
            const answer = event.event_data?.answer;
            if (answer && votes[answer] !== undefined) {
              votes[answer]++;
            }
          });
          
          console.log(`Initial poll votes loaded from legacy data for ${activationId}:`, votes);
          console.log(`Total legacy votes found: ${legacyData.length}`);
        }
      } else {
        // Count votes from poll_votes table
        if (data && data.length > 0) {
          data.forEach(vote => {
            const answer = vote.answer;
            if (votes[answer] !== undefined) {
              votes[answer]++;
            } else {
              votes[answer] = 1;
            }
          });
          
          console.log(`Initial poll votes loaded for ${activationId}:`, votes);
          console.log(`Total votes found: ${data.length}`);
        } else {
          console.log(`No votes found for activation ${activationId}, using zeros`);
        }
      }
      
      // Update with current vote counts
      onVotesUpdate(votes);
    } catch (err) {
      console.error('Error fetching initial poll votes:', err);
    }
  };
  
  // Fetch current poll state
  const fetchPollState = async () => {
    try {
      const { data, error } = await supabase
        .from('activations')
        .select('poll_state')
        .eq('id', activationId)
        .single();
        
      if (error) {
        console.error('Error fetching poll state:', error);
        return;
      }
      
      if (data && onPollStateChange) {
        onPollStateChange(data.poll_state || 'pending');
      }
    } catch (err) {
      console.error('Error fetching poll state:', err);
    }
  };
  
  // Run initial fetches
  fetchInitialVotes();
  fetchPollState();
  
  // Set up realtime subscription for new votes in poll_votes table
  const pollVotesChannel = supabase.channel(`poll_votes_table_${activationId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'poll_votes',
      filter: `activation_id=eq.${activationId}`
    }, payload => {
      console.log('New poll vote detected in poll_votes table:', payload);
      fetchInitialVotes(); // Refetch all votes to ensure consistency
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log(`Subscribed to poll_votes table for activation ${activationId}`);
      }
      if (err) {
        console.error(`Error subscribing to poll_votes table: ${err}`);
      }
    });
    
  // Also subscribe to legacy analytics_events for backward compatibility
  const analyticsChannel = supabase.channel(`poll_votes_analytics_${activationId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'analytics_events',
      filter: `event_type=eq.poll_vote AND activation_id=eq.${activationId}`
    }, payload => {
      console.log('New poll vote detected in analytics_events:', payload);
      fetchInitialVotes(); // Refetch all votes to ensure consistency
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log(`Subscribed to analytics_events for activation ${activationId}`);
      }
      if (err) {
        console.error(`Error subscribing to analytics_events: ${err}`);
      }
    });
  
  // Subscribe to poll state changes
  const stateChannel = supabase.channel(`poll_state_${activationId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'activations',
      filter: `id=eq.${activationId}`
    }, payload => {
      if (payload.new && payload.old && 
          payload.new.poll_state !== payload.old.poll_state && 
          onPollStateChange) {
        console.log(`Poll state changed to: ${payload.new.poll_state}`);
        onPollStateChange(payload.new.poll_state);
      }
    })
    .subscribe();
  
  // Also subscribe to broadcast channel for immediate updates
  const broadcastChannel = supabase.channel(`poll_broadcast_${activationId}`)
    .on('broadcast', { event: 'poll-vote' }, payload => {
      if (payload.payload?.votes) {
        console.log(`Received broadcast poll votes:`, payload.payload.votes);
        onVotesUpdate(payload.payload.votes);
      }
    })
    .on('broadcast', { event: 'poll-state-change' }, payload => {
      if (payload.payload?.state && onPollStateChange) {
        console.log(`Received broadcast poll state change:`, payload.payload.state);
        onPollStateChange(payload.payload.state);
      }
    })
    .subscribe();
  
  // Set up a periodic refresh to ensure data consistency
  const refreshInterval = setInterval(() => {
    fetchInitialVotes();
  }, 10000); // Refresh every 10 seconds
  
  // Return a cleanup function
  return () => {
    console.log(`Cleaning up poll subscriptions for ${activationId}`);
    pollVotesChannel.unsubscribe();
    analyticsChannel.unsubscribe();
    stateChannel.unsubscribe();
    broadcastChannel.unsubscribe();
    clearInterval(refreshInterval);
  };
}

/**
 * Get aggregated poll votes for an activation
 */
export async function getPollVotes(activationId: string): Promise<Record<string, number>> {
  try {
    console.log(`Fetching aggregated poll votes for activation ${activationId}`);
    
    // Get the options for this activation to initialize vote structure
    const { data: activation, error: actError } = await supabase
      .from('activations')
      .select('options')
      .eq('id', activationId)
      .single();
      
    if (actError) {
      console.error('Error getting poll options:', actError);
      return {};
    }
    
    // Initialize votes with zeros for all options
    const votes: Record<string, number> = {};
    if (activation?.options) {
      activation.options.forEach((option: any) => {
        votes[option.text] = 0;
      });
    }
    
    // Get all votes for this activation
    const { data, error } = await supabase
      .from('analytics_events')
      .select('event_data')
      .eq('event_type', 'poll_vote')
      .eq('activation_id', activationId);
      
    if (error) {
      console.error('Error fetching poll votes:', error);
      return votes;  // Return initialized zeros
    }
    
    // Count votes
    if (data && data.length > 0) {
      data.forEach(event => {
        const answer = event.event_data?.answer;
        if (answer && votes[answer] !== undefined) {
          votes[answer]++;
        }
      });
    }
    
    console.log(`Retrieved ${data?.length || 0} votes for activation ${activationId}`);
    console.log('Vote counts:', votes);
    
    return votes;
  } catch (error) {
    console.error('Error getting poll votes:', error);
    return {};
  }
}