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
    const gameChannel = supabase.channel(`game_session_${roomId}`)
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
        console.log(`Game session subscription status: ${status}`);
        if (err) {
          console.error('Game session subscription error:', err);
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
          const { data: players, error } = await supabase
            .from('players')
            .select('id, name, score, room_id, stats')
            .eq('room_id', roomId)
            .order('score', { ascending: false });

          if (error) {
            console.error('Error fetching players:', error);
            callbacks.onError?.(error);
            return;
          }

          console.log('Player update received, fetched players:', players?.length);
          callbacks.onPlayerChange?.(players || []);
        } catch (error) {
          console.error('Error fetching players:', error);
          callbacks.onError?.(error);
        }
      })
      .subscribe((status, err) => {
        console.log(`Players subscription status: ${status}`);
        if (err) {
          console.error('Players subscription error:', err);
          callbacks.onError?.(err);
        }
      });

    channels.push(playerChannel);

    // Subscribe to activation changes directly - critical for real-time updates
    const activationChannel = supabase.channel(`activation_updates_${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'activations',
        filter: `room_id=eq.${roomId} AND is_template=eq.false`
      }, async (payload) => {
        console.log('New activation created:', payload.new);
        
        try {
          // Check if this activation is currently active in the game session
          const { data: session } = await supabase
            .from('game_sessions')
            .select('current_activation')
            .eq('room_id', roomId)
            .maybeSingle();
            
          if (session?.current_activation === payload.new.id) {
            // This is the current activation, update the UI
            callbacks.onActivationChange?.(payload.new);
          }
        } catch (error) {
          console.error('Error checking if activation is current:', error);
          callbacks.onError?.(error);
        }
      })
      .subscribe((status, err) => {
        console.log(`Activations subscription status: ${status}`);
        if (err) {
          console.error('Activations subscription error:', err);
          callbacks.onError?.(err);
        }
      });
      
    channels.push(activationChannel);

    // Subscribe to activation updates - for poll state changes and other updates
    const activationUpdateChannel = supabase.channel(`activation_update_${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'activations',
        filter: `room_id=eq.${roomId} AND is_template=eq.false`
      }, async (payload) => {
        console.log('Activation updated:', payload.new);
        
        try {
          // Check if this is the current activation
          const { data: session } = await supabase
            .from('game_sessions')
            .select('current_activation')
            .eq('room_id', roomId)
            .maybeSingle();
            
          if (session?.current_activation === payload.new.id) {
            // This is the current activation, update the UI
            callbacks.onActivationChange?.(payload.new);
          }
        } catch (error) {
          console.error('Error checking if updated activation is current:', error);
          callbacks.onError?.(error);
        }
      })
      .subscribe((status, err) => {
        console.log(`Activation updates subscription status: ${status}`);
        if (err) {
          console.error('Activation updates subscription error:', err);
          callbacks.onError?.(err);
        }
      });
      
    channels.push(activationUpdateChannel);

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

export function subscribeToPollVotes(activationId: string, onVote: (votes: any) => void) {
  const channel = supabase.channel(`poll_${activationId}`)
    .on('broadcast', { event: 'poll-vote' }, (payload) => {
      if (payload.payload?.votes) {
        onVote(payload.payload.votes);
      }
    })
    .on('broadcast', { event: 'poll-state-change' }, (payload) => {
      // Handle poll state changes (voting/closed)
      console.log('Poll state changed:', payload);
    })
    .subscribe();

  // Also subscribe to analytics events for this poll to get initial votes
  const analyticsChannel = supabase.channel(`poll_analytics_${activationId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'analytics_events',
      filter: `activation_id=eq.${activationId}`
    }, (payload) => {
      if (payload.new.event_type === 'poll_vote') {
        console.log('New poll vote recorded:', payload.new);
      }
    })
    .subscribe();

  return () => {
    channel.unsubscribe();
    analyticsChannel.unsubscribe();
  };
}