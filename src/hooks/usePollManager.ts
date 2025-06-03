import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface PollOption {
  id?: string;
  text: string;
  media_type?: 'none' | 'image' | 'gif';
  media_url?: string;
}

interface PollVotes {
  [optionId: string]: number;
}

interface UsePollManagerProps {
  activationId: string | null;
  options?: PollOption[];
  playerId?: string | null;
}

export function usePollManager({ activationId, options = [], playerId }: UsePollManagerProps) {
  const [votes, setVotes] = useState<PollVotes>({});
  const [hasVoted, setHasVoted] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [pollState, setPollState] = useState<'pending' | 'voting' | 'closed'>('pending');
  const [isLoading, setIsLoading] = useState(false);
  const subscriptionRef = useRef<any>(null);
  const currentActivationRef = useRef<string | null>(null);

  // Reset everything when activation changes
  useEffect(() => {
    if (activationId !== currentActivationRef.current) {
      console.log('Poll activation changed, resetting state');
      currentActivationRef.current = activationId;
      
      // Clean reset of all state
      setVotes({});
      setHasVoted(false);
      setSelectedOptionId(null);
      setPollState('pending');
      
      // Clean up old subscription
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    }
  }, [activationId]);

  // Initialize and subscribe to poll data
  useEffect(() => {
    if (!activationId) return;

    const initializePoll = async () => {
      setIsLoading(true);
      
      try {
        // Get poll state from activation
        const { data: activation } = await supabase
          .from('activations')
          .select('poll_state')
          .eq('id', activationId)
          .single();
        
        if (activation) {
          setPollState(activation.poll_state || 'pending');
        }

        // Get all votes for this poll
        const { data: voteData } = await supabase
          .from('poll_votes')
          .select('option_id, player_id')
          .eq('activation_id', activationId);

        if (voteData) {
          // Count votes by option
          const voteCounts: PollVotes = {};
          options.forEach(option => {
            if (option.id) {
              voteCounts[option.id] = 0;
            }
          });

          voteData.forEach(vote => {
            if (vote.option_id && voteCounts[vote.option_id] !== undefined) {
              voteCounts[vote.option_id]++;
            }
            
            // Check if current player has voted
            if (playerId && vote.player_id === playerId) {
              setHasVoted(true);
              setSelectedOptionId(vote.option_id);
            }
          });

          setVotes(voteCounts);
        }
      } catch (error) {
        console.error('Error initializing poll:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializePoll();

    // Subscribe to changes
    const channel = supabase
      .channel(`poll_${activationId}`)
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
          
          // Update vote count
          const optionId = payload.new.option_id;
          if (optionId) {
            setVotes(prev => ({
              ...prev,
              [optionId]: (prev[optionId] || 0) + 1
            }));
          }

          // Check if it's the current player's vote
          if (playerId && payload.new.player_id === playerId) {
            setHasVoted(true);
            setSelectedOptionId(optionId);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'activations',
          filter: `id=eq.${activationId}`
        },
        (payload) => {
          console.log('Poll state updated:', payload.new.poll_state);
          if (payload.new.poll_state) {
            setPollState(payload.new.poll_state);
          }
        }
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [activationId, options, playerId]);

  // Submit vote
  const submitVote = useCallback(async (optionId: string) => {
    if (!activationId || !playerId || hasVoted || pollState !== 'voting') {
      return { success: false, error: 'Cannot submit vote' };
    }

    try {
      const { error } = await supabase
        .from('poll_votes')
        .insert({
          activation_id: activationId,
          player_id: playerId,
          option_id: optionId,
          option_text: options.find(opt => opt.id === optionId)?.text || ''
        });

      if (error) throw error;

      // Update local state immediately
      setHasVoted(true);
      setSelectedOptionId(optionId);
      setVotes(prev => ({
        ...prev,
        [optionId]: (prev[optionId] || 0) + 1
      }));

      return { success: true };
    } catch (error: any) {
      console.error('Error submitting vote:', error);
      return { success: false, error: error.message };
    }
  }, [activationId, playerId, hasVoted, pollState, options]);

  // Get votes by text for display
  const getVotesByText = useCallback(() => {
    const votesByText: { [text: string]: number } = {};
    
    options.forEach(option => {
      if (option.id && votes[option.id] !== undefined) {
        votesByText[option.text] = votes[option.id];
      } else {
        votesByText[option.text] = 0;
      }
    });

    return votesByText;
  }, [votes, options]);

  const getTotalVotes = useCallback(() => {
    return Object.values(votes).reduce((sum, count) => sum + count, 0);
  }, [votes]);

  return {
    votes,
    votesByText: getVotesByText(),
    totalVotes: getTotalVotes(),
    hasVoted,
    selectedOptionId,
    pollState,
    isLoading,
    submitVote
  };
}