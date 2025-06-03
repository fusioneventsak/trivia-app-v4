import { supabase } from './supabase';

// Simple functions to get current state of a poll that don't use subscriptions

// Simple check if a player has already voted
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

// Get all votes for an activation (one-time fetch, no subscription)
export const getPollVotes = async (activationId: string): Promise<Record<string, number>> => {
  try {
    console.log(`Fetching poll votes for activation ${activationId}`);
    
    // Get all votes from poll_votes table
    const { data, error } = await supabase
      .from('poll_votes')
      .select('option_id')
      .eq('activation_id', activationId);
      
    if (error) {
      console.error('Error fetching poll votes:', error);
      return {};
    }
    
    // Count votes by option
    const votes: Record<string, number> = {};
    
    data.forEach(vote => {
      if (!vote.option_id) return;
      
      votes[vote.option_id] = (votes[vote.option_id] || 0) + 1;
    });
    
    console.log('Poll votes fetched:', votes);
    return votes;
  } catch (err) {
    console.error('Error in getPollVotes:', err);
    return {};
  }
};

// The minimum subscription function needed for compatibility
// Just returns a cleanup function
export const subscribeToPollVotes = (
  activationId: string, 
  onVotesUpdate: (votes: Record<string, number>) => void,
  onPollStateChange?: (state: 'pending' | 'voting' | 'closed') => void
): (() => void) => {
  console.log(`Legacy subscribeToPollVotes called for ${activationId} - using usePollManager hook instead`);
  return () => {};
};

// Legacy submitPollVote for backward compatibility
export const submitPollVote = async (
  activationId: string,
  playerId: string,
  optionId: string
): Promise<{ success: boolean; error?: string }> => {
  console.log('Legacy submitPollVote called - using usePollManager hook instead');
  
  try {
    // Check if player already voted
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
        option_id: optionId,
        option_text: '' // Required but not used anymore
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