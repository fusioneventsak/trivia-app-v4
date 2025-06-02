import { supabase } from './supabase';

interface PollVotes {
  [key: string]: number;
}

// Get poll votes for an activation
export const getPollVotes = async (activationId: string): Promise<PollVotes> => {
  try {
    const { data, error } = await supabase
      .from('poll_votes')
      .select('option_id')
      .eq('activation_id', activationId);
      
    if (error) {
      console.error('Error fetching poll votes:', error);
      throw error;
    }
    
    // Count votes by option_id
    const votes: PollVotes = {};
    data?.forEach(vote => {
      if (vote.option_id) {
        votes[vote.option_id] = (votes[vote.option_id] || 0) + 1;
      }
    });
    
    console.log('Poll votes fetched:', votes);
    return votes;
  } catch (err) {
    console.error('Error in getPollVotes:', err);
    return {};
  }
};

// Subscribe to poll votes changes
export const subscribeToPollVotes = (
  activationId: string, 
  onVotesUpdate: (votes: PollVotes) => void,
  onPollStateChange?: (state: 'pending' | 'voting' | 'closed') => void
): (() => void) => {
  // Initial fetch
  const fetchVotes = async () => {
    const votes = await getPollVotes(activationId);
    onVotesUpdate(votes);
  };
  
  fetchVotes();
  
  // Subscribe to poll_votes changes
  const votesChannel = supabase
    .channel(`poll_votes_${activationId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'poll_votes',
      filter: `activation_id=eq.${activationId}`
    }, async () => {
      console.log('Poll votes changed, fetching updated votes');
      const votes = await getPollVotes(activationId);
      onVotesUpdate(votes);
    })
    .subscribe();
    
  // Subscribe to activation changes (for poll state)
  const activationChannel = supabase
    .channel(`activation_poll_state_${activationId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'activations',
      filter: `id=eq.${activationId}`
    }, (payload) => {
      if (payload.new?.poll_state && onPollStateChange) {
        console.log('Poll state changed:', payload.new.poll_state);
        onPollStateChange(payload.new.poll_state);
      }
    })
    .subscribe();
  
  // Return cleanup function
  return () => {
    votesChannel.unsubscribe();
    activationChannel.unsubscribe();
  };
};

// Check if a player has already voted
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
  optionId: string
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
        option_id: optionId
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