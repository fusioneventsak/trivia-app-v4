// src/hooks/usePollManager.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface PollOption {
  id?: string;
  text: string;
  media_type?: 'none' | 'image' | 'gif';
  media_url?: string;
}

interface PollVote {
  id: string;
  activation_id: string;
  player_id: string;
  option_id: string;
  option_text: string;
  created_at?: string;
}

interface PollVoteCount {
  [optionId: string]: number;
}

interface UsePollManagerProps {
  activationId: string | null;
  options?: PollOption[];
  playerId?: string | null;
}

interface UsePollManagerReturn {
  votes: PollVoteCount;
  votesByText: { [text: string]: number };
  totalVotes: number;
  hasVoted: boolean;
  selectedOptionId: string | null;
  pollState: 'pending' | 'voting' | 'closed';
  isLoading: boolean;
  submitVote: (optionId: string) => Promise<{ success: boolean; error?: string }>;
  resetPoll: () => void;
}

export function usePollManager({ 
  activationId, 
  options = [], 
  playerId 
}: UsePollManagerProps): UsePollManagerReturn {
  const [votes, setVotes] = useState<PollVoteCount>({});
  const [votesByText, setVotesByText] = useState<{ [text: string]: number }>({});
  const [hasVoted, setHasVoted] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [pollState, setPollState] = useState<'pending' | 'voting' | 'closed'>('pending');
  const [isLoading, setIsLoading] = useState(false);

  // Function to fetch all poll data
  const fetchPollData = useCallback(async () => {
    if (!activationId) return;
    
    try {
      // Get poll state from activation
      const { data: activation, error: activationError } = await supabase
        .from('activations')
        .select('poll_state, options')
        .eq('id', activationId)
        .single();
      
      if (activationError) {
        console.error('Error fetching activation:', activationError);
        return;
      }
      
      if (activation) {
        setPollState(activation.poll_state || 'pending');
        
        // Initialize vote counts
        const voteCounts: PollVoteCount = {};
        const textVoteCounts: { [text: string]: number } = {};
        
        // Use options from activation or props
        const pollOptions = activation.options || options;
        
        // Initialize all options to 0
        pollOptions.forEach((option: PollOption) => {
          if (option.id) {
            voteCounts[option.id] = 0;
          }
          textVoteCounts[option.text] = 0;
        });

        // Get all votes for this poll
        const { data: voteData, error: voteError } = await supabase
          .from('poll_votes')
          .select('*')
          .eq('activation_id', activationId);

        if (voteError) {
          console.error('Error fetching votes:', voteError);
          return;
        }
        
        // Reset player vote status
        let playerHasVoted = false;
        let playerSelectedOption: string | null = null;
        
        // Count votes
        if (voteData) {
          voteData.forEach((vote: PollVote) => {
            // Count by option ID if available
            if (vote.option_id && voteCounts[vote.option_id] !== undefined) {
              voteCounts[vote.option_id]++;
            }
            
            // Always count by option text
            if (vote.option_text && textVoteCounts[vote.option_text] !== undefined) {
              textVoteCounts[vote.option_text]++;
            }
            
            // Check if current player has voted
            if (playerId && vote.player_id === playerId) {
              playerHasVoted = true;
              playerSelectedOption = vote.option_id;
            }
          });
        }

        // Update all states at once
        setVotes(voteCounts);
        setVotesByText(textVoteCounts);
        setHasVoted(playerHasVoted);
        setSelectedOptionId(playerSelectedOption);
      }
    } catch (error) {
      console.error('Error fetching poll data:', error);
    }
  }, [activationId, options, playerId]);

  // Poll for updates every 2 seconds
  useEffect(() => {
    if (!activationId) {
      // Reset state when no activation
      setVotes({});
      setVotesByText({});
      setHasVoted(false);
      setSelectedOptionId(null);
      setPollState('pending');
      return;
    }

    // Initial fetch
    setIsLoading(true);
    fetchPollData().finally(() => setIsLoading(false));
    
    // Set up polling interval
    const interval = setInterval(() => {
      fetchPollData();
    }, 2000); // Poll every 2 seconds
    
    // Cleanup
    return () => {
      clearInterval(interval);
    };
  }, [activationId, fetchPollData]);

  // Submit vote
  const submitVote = useCallback(async (optionId: string): Promise<{ success: boolean; error?: string }> => {
    if (!activationId || !playerId) {
      return { success: false, error: 'Missing activation or player ID' };
    }

    if (hasVoted) {
      return { success: false, error: 'You have already voted' };
    }

    if (pollState !== 'voting') {
      return { success: false, error: 'Voting is not open' };
    }

    try {
      // Find the option
      const option = options.find(opt => opt.id === optionId);
      if (!option) {
        return { success: false, error: 'Invalid option' };
      }

      console.log('Submitting vote:', { activationId, playerId, optionId, optionText: option.text });

      // Submit the vote
      const { error } = await supabase
        .from('poll_votes')
        .insert({
          activation_id: activationId,
          player_id: playerId,
          option_id: optionId,
          option_text: option.text
        });

      if (error) {
        console.error('Vote submission error:', error);
        // Check for duplicate vote
        if (error.code === '23505') {
          return { success: false, error: 'You have already voted' };
        }
        throw error;
      }

      // Update local state immediately for better UX
      setHasVoted(true);
      setSelectedOptionId(optionId);
      
      // Update vote counts immediately (optimistic update)
      setVotes(prev => ({
        ...prev,
        [optionId]: (prev[optionId] || 0) + 1
      }));
      
      setVotesByText(prev => ({
        ...prev,
        [option.text]: (prev[option.text] || 0) + 1
      }));

      console.log('Vote submitted successfully');
      
      // Force a refresh to get the latest data
      setTimeout(fetchPollData, 500);
      
      return { success: true };
    } catch (error: any) {
      console.error('Error submitting vote:', error);
      return { success: false, error: error.message || 'Failed to submit vote' };
    }
  }, [activationId, playerId, hasVoted, pollState, options, fetchPollData]);

  // Reset poll state
  const resetPoll = useCallback(() => {
    setVotes({});
    setVotesByText({});
    setHasVoted(false);
    setSelectedOptionId(null);
    setPollState('pending');
  }, []);

  // Calculate total votes
  const getTotalVotes = useCallback((): number => {
    // Use votesByText as the source of truth
    return Object.values(votesByText).reduce((sum, count) => sum + count, 0);
  }, [votesByText]);

  return {
    votes,
    votesByText,
    totalVotes: getTotalVotes(),
    hasVoted,
    selectedOptionId,
    pollState,
    isLoading,
    submitVote,
    resetPoll
  };
}