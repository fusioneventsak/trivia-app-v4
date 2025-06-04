import { useState, useEffect, useRef, useCallback } from 'react';
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
  
  // Track subscriptions
  const votesChannelRef = useRef<any>(null);
  const activationChannelRef = useRef<any>(null);
  const currentActivationIdRef = useRef<string | null>(null);

  // Initialize poll data
  const initializePoll = useCallback(async () => {
    if (!activationId) return;
    
    setIsLoading(true);
    
    try {
      // Get poll state from activation
      const { data: activation, error: activationError } = await supabase
        .from('activations')
        .select('poll_state, options')
        .eq('id', activationId)
        .single();
      
      if (activationError) {
        console.error('Error fetching activation:', activationError);
      } else if (activation) {
        setPollState(activation.poll_state || 'pending');
        
        // Ensure options have IDs
        const pollOptions = (activation.options || options).map((opt: PollOption, index: number) => ({
          ...opt,
          id: opt.id || `option-${index}`
        }));
        
        // Initialize vote counts
        const voteCounts: PollVoteCount = {};
        const textVoteCounts: { [text: string]: number } = {};
        
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
        } else if (voteData) {
          // Count votes
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
              setHasVoted(true);
              setSelectedOptionId(vote.option_id);
            }
          });
        }

        setVotes(voteCounts);
        setVotesByText(textVoteCounts);
      }
    } catch (error) {
      console.error('Error initializing poll:', error);
    } finally {
      setIsLoading(false);
    }
  }, [activationId, options, playerId]);

  // Reset poll state
  const resetPoll = useCallback(() => {
    setVotes({});
    setVotesByText({});
    setHasVoted(false);
    setSelectedOptionId(null);
    setPollState('pending');
    
    // Unsubscribe from channels
    if (votesChannelRef.current) {
      votesChannelRef.current.unsubscribe();
      votesChannelRef.current = null;
    }
    if (activationChannelRef.current) {
      activationChannelRef.current.unsubscribe();
      activationChannelRef.current = null;
    }
  }, []);

  // Effect to handle activation changes
  useEffect(() => {
    // Check if activation has changed
    if (activationId !== currentActivationIdRef.current) {
      console.log('Poll activation changed:', activationId);
      currentActivationIdRef.current = activationId;
      
      // Reset state for new activation
      resetPoll();
      
      // Initialize new poll if we have an activation
      if (activationId) {
        initializePoll();
      }
    }
  }, [activationId, initializePoll, resetPoll]);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!activationId) return;

    console.log('Setting up poll subscriptions for activation:', activationId);

    // Subscribe to vote changes
    const votesChannel = supabase
      .channel(`poll_votes_${activationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'poll_votes',
          filter: `activation_id=eq.${activationId}`
        },
        (payload) => {
          console.log('New vote received:', payload.new);
          
          const newVote = payload.new as PollVote;
          
          // Update vote count by ID
          if (newVote.option_id) {
            setVotes(prev => ({
              ...prev,
              [newVote.option_id]: (prev[newVote.option_id] || 0) + 1
            }));
          }
          
          // Always update vote count by text
          if (newVote.option_text) {
            setVotesByText(prev => ({
              ...prev,
              [newVote.option_text]: (prev[newVote.option_text] || 0) + 1
            }));
          }

          // Check if it's the current player's vote
          if (playerId && newVote.player_id === playerId) {
            setHasVoted(true);
            setSelectedOptionId(newVote.option_id);
          }
        }
      )
      .subscribe((status) => {
        console.log('Poll votes subscription status:', status);
      });

    votesChannelRef.current = votesChannel;

    // Subscribe to activation state changes
    const activationChannel = supabase
      .channel(`activation_state_${activationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'activations',
          filter: `id=eq.${activationId}`
        },
        (payload) => {
          console.log('Activation state updated:', payload.new);
          
          if (payload.new.poll_state) {
            setPollState(payload.new.poll_state);
          }
        }
      )
      .subscribe((status) => {
        console.log('Activation state subscription status:', status);
      });

    activationChannelRef.current = activationChannel;

    // Cleanup
    return () => {
      console.log('Cleaning up poll subscriptions');
      if (votesChannelRef.current) {
        votesChannelRef.current.unsubscribe();
        votesChannelRef.current = null;
      }
      if (activationChannelRef.current) {
        activationChannelRef.current.unsubscribe();
        activationChannelRef.current = null;
      }
    };
  }, [activationId, playerId]);

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

      if (error) throw error;

      // Update local state immediately for optimistic UI
      setHasVoted(true);
      setSelectedOptionId(optionId);
      
      // Update vote counts immediately
      setVotes(prev => ({
        ...prev,
        [optionId]: (prev[optionId] || 0) + 1
      }));
      
      setVotesByText(prev => ({
        ...prev,
        [option.text]: (prev[option.text] || 0) + 1
      }));

      console.log('Vote submitted successfully');
      return { success: true };
    } catch (error: any) {
      console.error('Error submitting vote:', error);
      return { success: false, error: error.message || 'Failed to submit vote' };
    }
  }, [activationId, playerId, hasVoted, pollState, options]);

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