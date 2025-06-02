import { supabase } from './supabase';

interface PollVotes {
  [key: string]: number;
}

// Get poll votes for an activation
export const getPollVotes = async (activationId: string): Promise<PollVotes> => {
  try {
    console.log(`Fetching poll votes for activation ${activationId}`);
    
    // First get the activation to get the options
    const { data: activation, error: actError } = await supabase
      .from('activations')
      .select('options')
      .eq('id', activationId)
      .single();
    
    if (actError) {
      console.error('Error fetching activation options:', actError);
      return {};
    }
    
    // Initialize votes object with zeros for all options
    const votes: PollVotes = {};
    if (activation?.options) {
      activation.options.forEach((option: any) => {
        if (option.id) {
          votes[option.id] = 0;
        } else if (option.text) {
          // Fallback to using text as key if no ID
          votes[option.text] = 0;
        }
      });
    }
    
    // Get all votes from the poll_votes table
    const { data, error } = await supabase
      .from('poll_votes')
      .select('option_id, option_text')
      .eq('activation_id', activationId);
      
    if (error) {
      console.error('Error fetching poll votes:', error);
      return votes; // Return initialized zeros
    }
    
    // Count votes
    data?.forEach(vote => {
      // Prefer option_id if available
      if (vote.option_id && votes[vote.option_id] !== undefined) {
        votes[vote.option_id] = (votes[vote.option_id] || 0) + 1;
      } 
      // Fall back to option_text for backward compatibility
      else if (vote.option_text) {
        // Try to find the option ID that matches this text
        const matchingOption = activation?.options?.find(
          (opt: any) => opt.text === vote.option_text
        );
        
        if (matchingOption?.id) {
          votes[matchingOption.id] = (votes[matchingOption.id] || 0) + 1;
        } else {
          // Last resort: use the text as the key
          votes[vote.option_text] = (votes[vote.option_text] || 0) + 1;
        }
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
  optionText: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    // First check if player already voted
    const hasVoted = await checkIfPlayerVoted(activationId, playerId);
    if (hasVoted) {
      return { success: false, error: 'You have already voted in this poll' };
    }
    
    // Get the activation to find the option ID
    const { data: activation, error: actError } = await supabase
      .from('activations')
      .select('options')
      .eq('id', activationId)
      .single();
      
    if (actError) {
      console.error('Error fetching activation:', actError);
      return { success: false, error: 'Failed to fetch activation details' };
    }
    
    // Find the option ID that matches the text
    let optionId: string | null = null;
    if (activation?.options) {
      const matchingOption = activation.options.find(
        (opt: any) => opt.text === optionText
      );
      if (matchingOption?.id) {
        optionId = matchingOption.id;
      }
    }
    
    // Submit the vote
    const { error } = await supabase
      .from('poll_votes')
      .insert({
        activation_id: activationId,
        player_id: playerId,
        option_id: optionId,
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