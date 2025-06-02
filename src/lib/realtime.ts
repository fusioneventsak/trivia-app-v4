import { supabase } from './supabase';

export interface PollVotes {
  [optionText: string]: number;
}

export type PollState = 'pending' | 'voting' | 'closed';

export const getPollVotes = async (activationId: string): Promise<PollVotes> => {
  try {
    // Query poll votes directly from the table
    const { data, error } = await supabase
      .from('poll_votes')
      .select('option_text')
      .eq('activation_id', activationId);
      
    if (error) {
      console.error('Error fetching poll votes:', error);
      return {};
    }
    
    // Count votes for each option
    const votes: PollVotes = {};
    if (data && Array.isArray(data)) {
      data.forEach((vote: any) => {
        const optionText = vote.option_text;
        votes[optionText] = (votes[optionText] || 0) + 1;
      });
    }
    
    console.log('Fetched poll votes:', votes);
    return votes;
  } catch (err) {
    console.error('Error in getPollVotes:', err);
    return {};
  }
};

export const subscribeToPollVotes = (
  activationId: string,
  onVotesUpdate: (votes: PollVotes) => void,
  onStateChange?: (state: PollState) => void
): (() => void) => {
  console.log('Setting up poll subscription for activation:', activationId);
  
  // Function to fetch current votes
  const fetchVotes = async () => {
    const votes = await getPollVotes(activationId);
    onVotesUpdate(votes);
  };
  
  // Initial fetch
  fetchVotes();
  
  // Subscribe to poll_votes changes
  const votesChannel = supabase
    .channel(`poll_votes_${activationId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'poll_votes',
        filter: `activation_id=eq.${activationId}`
      },
      (payload) => {
        console.log('Poll vote change detected:', payload);
        fetchVotes();
      }
    )
    .subscribe();
    
  // Subscribe to activation changes for poll state
  let activationChannel: any = null;
  if (onStateChange) {
    activationChannel = supabase
      .channel(`poll_state_${activationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'activations',
          filter: `id=eq.${activationId}`
        },
        (payload) => {
          if (payload.new?.poll_state) {
            console.log('Poll state changed to:', payload.new.poll_state);
            onStateChange(payload.new.poll_state as PollState);
          }
        }
      )
      .subscribe();
  }
  
  // Return cleanup function
  return () => {
    console.log('Cleaning up poll subscription for activation:', activationId);
    votesChannel.unsubscribe();
    if (activationChannel) {
      activationChannel.unsubscribe();
    }
  };
};

export const checkIfPlayerVoted = async (
  activationId: string,
  playerId: string
): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('poll_votes')
      .select('id')
      .eq('activation_id', activationId)
      .eq('player_id', playerId)
      .maybeSingle();
      
    if (error) {
      console.error('Error checking if player voted:', error);
      return false;
    }
    
    return !!data;
  } catch (err) {
    console.error('Error in checkIfPlayerVoted:', err);
    return false;
  }
};

export const submitPollVote = async (
  activationId: string,
  playerId: string,
  optionText: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    // First check if player already voted
    const hasVoted = await checkIfPlayerVoted(activationId, playerId);
    if (hasVoted) {
      return { success: false, error: 'You have already voted in this poll' };
    }
    
    // Submit the vote
    const { error } = await supabase
      .from('poll_votes')
      .insert({
        activation_id: activationId,
        player_id: playerId,
        option_text: optionText
      });
      
    if (error) {
      console.error('Error submitting poll vote:', error);
      
      // Check for unique constraint violation
      if (error.code === '23505') {
        return { success: false, error: 'You have already voted in this poll' };
      }
      
      return { success: false, error: error.message };
    }
    
    console.log('Poll vote submitted successfully');
    return { success: true };
  } catch (err: any) {
    console.error('Error in submitPollVote:', err);
    return { success: false, error: err.message || 'Failed to submit vote' };
  }
};