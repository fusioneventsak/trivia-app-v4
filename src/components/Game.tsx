import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { Trophy, Settings, CheckCircle, XCircle, Users, Send, Clock, PlayCircle, X, Lock, WifiOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { subscribeToRoomUpdates, subscribeToPollVotes } from '../lib/realtime';
import confetti from 'canvas-confetti';
import { useTheme } from '../context/ThemeContext';
import CountdownTimer from './ui/CountdownTimer';
import PointAnimation from './ui/PointAnimation';
import PointsDisplay from './ui/PointsDisplay';
import { calculatePoints, POINT_CONFIG } from '../lib/point-calculator';
import LeaderboardItem from './ui/LeaderboardItem';
import { hasPlayerAnswered, hasPlayerVoted, getPlayerPollVote, recordPollVote, getPollVotes } from '../lib/point-distribution';
import PollStateIndicator from './ui/PollStateIndicator';
import PollDisplay from './ui/PollDisplay';
import { APIClient } from '../lib/api-client';

// Helper function to get public URL for Supabase storage items
const getStorageUrl = (url: string): string => {
  if (!url) return '';
  
  // If it's already a full URL, return it
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // If it's a storage path, convert it to a public URL
  if (url.startsWith('public/')) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    return `${supabaseUrl}/storage/v1/object/public/${url}`;
  }
  
  return url;
};

interface Option {
  text: string;
  media_type: 'none' | 'image' | 'gif';
  media_url: string;
  color?: string;
}

type ActivationType = 'multiple_choice' | 'text_answer' | 'poll' | 'social_wall' | 'leaderboard';
type PollDisplayType = 'bar' | 'pie' | 'horizontal' | 'vertical';
type PollState = 'pending' | 'voting' | 'closed';
type PollResultFormat = 'percentage' | 'votes' | 'both';

interface Activation {
  id: string;
  type: ActivationType;
  question: string;
  options?: Option[];
  correct_answer?: string;
  exact_answer?: string;
  media_type: 'none' | 'image' | 'youtube' | 'gif';
  media_url: string;
  poll_display_type?: PollDisplayType;
  poll_state?: PollState;
  poll_result_format?: PollResultFormat;
  room_id?: string;
  time_limit?: number;
  timer_started_at?: string;
  show_answers?: boolean;
  theme?: {
    primary_color: string;
    secondary_color: string;
    background_color: string;
    text_color: string;
  };
}

interface PollVotes {
  [key: string]: number;
}

interface PlayerType {
  id: string;
  name: string;
  score: number;
  room_id?: string;
  stats?: {
    totalPoints: number;
    correctAnswers: number;
    totalAnswers: number;
    averageResponseTimeMs: number;
  };
}

export default function Game() {
  const navigate = useNavigate();
  const location = useLocation();
  const { roomId } = useParams();
  const { isLiveMode, currentActivation, currentPlayerId, setCurrentPlayerId, getCurrentPlayer } = useGameStore();
  const currentPlayer = getCurrentPlayer();
  const [activeQuestion, setActiveQuestion] = useState<Activation | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string>('');
  const [textAnswer, setTextAnswer] = useState('');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [otherPlayers, setOtherPlayers] = useState<PlayerType[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const leaderboardRef = useRef<HTMLDivElement>(null);
  const [pollVotes, setPollVotes] = useState<PollVotes>({});
  const [totalVotes, setTotalVotes] = useState(0);
  const [pollVoted, setPollVoted] = useState(false);
  const [pollSubscription, setPollSubscription] = useState<(() => void) | null>(null);
  const [pollState, setPollState] = useState<PollState>('pending');
  const [activationHistory, setActivationHistory] = useState<Activation[]>([]);
  const [room, setRoom] = useState<any>(null);
  const [networkError, setNetworkError] = useState(false);
  const { theme } = useTheme();
  
  // Timer state
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Point animation state
  const [pointsEarned, setPointsEarned] = useState<number>(0);
  const [answerStartTime, setAnswerStartTime] = useState<number | null>(null);
  const [playerRankings, setPlayerRankings] = useState<{[key: string]: number}>({});
  const [previousRankings, setPreviousRankings] = useState<{[key: string]: number}>({});
  const [hasCheckedAnswer, setHasCheckedAnswer] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  // Add state to track if we're checking poll vote status
  const [isCheckingPollVote, setIsCheckingPollVote] = useState(false);
  const [pollVoteCheckComplete, setPollVoteCheckComplete] = useState(false);

  // Add debug button with key combo (press d+e+b+u+g in order)
  useEffect(() => {
    const keys: string[] = [];
    const debugCode = ['d', 'e', 'b', 'u', 'g'];
    
    const keyHandler = (event: KeyboardEvent) => {
      keys.push(event.key.toLowerCase());
      if (keys.length > 5) keys.shift();
      
      if (keys.join('') === debugCode.join('')) {
        setDebugMode(prev => !prev);
        console.log('Debug mode:', !debugMode);
      }
    };
    
    window.addEventListener('keydown', keyHandler);
    return () => {
      window.removeEventListener('keydown', keyHandler);
    };
  }, [debugMode]);

  // Add network status event listeners
  useEffect(() => {
    const handleOnline = () => setNetworkError(false);
    const handleOffline = () => setNetworkError(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Check if player exists - if not, redirect to join page
  useEffect(() => {
    if (!currentPlayerId || !getCurrentPlayer()) {
      // Player doesn't exist, redirect back to join page
      console.log("No player found, redirecting to join page");
      navigate('/join', { 
        state: { 
          roomId: roomId,
          message: "Please enter your name to rejoin the game."
        }
      });
    }
  }, [currentPlayerId, getCurrentPlayer, navigate, roomId]);

  // Fetch room data when roomId changes
  useEffect(() => {
    if (roomId) {
      const fetchRoom = async () => {
        try {
          const { data, error } = await supabase
            .from('rooms')
            .select('*')
            .eq('id', roomId)
            .single();
            
          if (error) throw error;
          setRoom(data);
        } catch (err) {
          console.error('Error fetching room:', err);
        }
      };
      
      fetchRoom();
    }
  }, [roomId]);

  // Check poll vote status when activation changes
  const checkPollVoteStatus = async (activation: Activation) => {
    if (activation.type === 'poll' && activation.id && currentPlayerId && !isCheckingPollVote) {
      try {
        setIsCheckingPollVote(true);
        setPollVoteCheckComplete(false);
        
        const hasVoted = await hasPlayerVoted(activation.id, currentPlayerId);
        setPollVoted(hasVoted);
        
        if (hasVoted) {
          // Get their previous vote
          const playerVote = await getPlayerPollVote(activation.id, currentPlayerId);
          if (playerVote) {
            setSelectedAnswer(playerVote);
          }
        }
        
        setPollVoteCheckComplete(true);
        
        if (debugMode) {
          console.log('Poll vote status check:', { 
            activationId: activation.id, 
            hasVoted, 
            playerVote: await getPlayerPollVote(activation.id, currentPlayerId) 
          });
        }
      } catch (err) {
        console.error("Error checking player's poll vote:", err);
        setPollVoteCheckComplete(true);
      } finally {
        setIsCheckingPollVote(false);
      }
    } else if (activation.type !== 'poll') {
      setPollVoteCheckComplete(true);
    }
  };

  // Subscribe to real-time updates
  useEffect(() => {
    if (!roomId) return;

    const cleanup = subscribeToRoomUpdates(roomId, {
      onActivationChange: async (activation) => {
        if (debugMode) {
          console.log("New activation received:", activation);
        }
        
        setActiveQuestion(activation);
        // Reset state for new activation
        setSelectedAnswer('');
        setTextAnswer('');
        setHasAnswered(false);
        setShowResult(false);
        setIsCorrect(false);
        setPollVoted(false);
        setPointsEarned(0);
        setAnswerStartTime(null);
        setHasCheckedAnswer(false);
        setPollVoteCheckComplete(false);

        // Handle the poll activation
        if (activation?.type === 'poll') {
          await initPollVotes(activation);
          setPollState(activation.poll_state || 'pending');
          
          // Check if player has already voted for this poll
          await checkPollVoteStatus(activation);
          
          // Clean up previous subscription
          if (pollSubscription) {
            pollSubscription();
          }
          
          // Set up new subscription
          const cleanup = subscribeToPollVotes(
            activation.id, 
            (votes) => {
              console.log("Poll votes updated:", votes);
              setPollVotes(votes);
              setTotalVotes(Object.values(votes).reduce((sum, count) => sum + count, 0));
            },
            (state) => {
              console.log("Poll state changed:", state);
              setPollState(state || 'pending');
            }
          );
          setPollSubscription(() => cleanup);
        } else {
          // Clean up poll subscription if not a poll
          if (pollSubscription) {
            pollSubscription();
            setPollSubscription(null);
          }
          setPollVoteCheckComplete(true);
        }
        
        // Setup timer if needed
        setupTimer(activation);
        
        // Set answer start time for point calculation
        if (activation && (activation.type === 'multiple_choice' || activation.type === 'text_answer')) {
          setAnswerStartTime(Date.now());
        }
      },
      onPlayerChange: (players) => {
        if (currentPlayerId) {
          const currentPlayer = players.find(p => p.id === currentPlayerId);
          if (currentPlayer) {
            useGameStore.getState().addPlayer(currentPlayer);
            
            if (debugMode) {
              console.log('Current player updated:', currentPlayer);
            }
          }
          
          // Save previous rankings before updating
          const prevRanks: {[key: string]: number} = {};
          players.forEach((player, index) => {
            prevRanks[player.id] = index + 1;
          });
          
          // Only update previous rankings if we have current rankings
          if (Object.keys(playerRankings).length > 0) {
            setPreviousRankings(playerRankings);
          }
          
          // Update current rankings
          const newRanks: {[key: string]: number} = {};
          players.sort((a, b) => b.score - a.score)
            .forEach((player, index) => {
              newRanks[player.id] = index + 1;
            });
          setPlayerRankings(newRanks);
          
          setOtherPlayers(players.filter(p => p.id !== currentPlayerId));
        }
      },
      onError: (error) => {
        console.error('Subscription error:', error);
        setNetworkError(true);
      }
    });

    return () => {
      cleanup?.();
      if (pollSubscription) {
        pollSubscription();
        setPollSubscription(null);
      }
      
      // Clear any active timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [roomId, currentPlayerId, debugMode]);

  // Re-check poll vote status when activeQuestion changes or player ID changes
  useEffect(() => {
    if (activeQuestion && activeQuestion.type === 'poll' && currentPlayerId) {
      checkPollVoteStatus(activeQuestion);
    }
  }, [activeQuestion?.id, currentPlayerId]);
  
  // Setup timer when activation changes or timer starts
  const setupTimer = (activation: any) => {
    // Clear any existing timer
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    // Reset timer state
    setTimeRemaining(null);
    setShowAnswers(false); // Default to showing answers
    
    // If no activation or no time limit, show answers and return
    if (!activation || !activation.time_limit) {
      setShowAnswers(activation?.show_answers !== false);
      return;
    }
    
    // Check if timer has already started
    if (activation.timer_started_at) {
      const startTime = new Date(activation.timer_started_at).getTime();
      const currentTime = new Date().getTime();
      const elapsedMs = currentTime - startTime;
      const totalTimeMs = activation.time_limit * 1000;
      
      // If timer has already expired, show answers
      if (elapsedMs >= totalTimeMs) {
        setTimeRemaining(0);
        setShowAnswers(true); // Always show answers when timer expires
        return;
      }
      
      // Otherwise, calculate remaining time and start countdown
      const remainingMs = totalTimeMs - elapsedMs;
      setTimeRemaining(Math.ceil(remainingMs / 1000));
      setShowAnswers(false);
      
      // Start countdown timer
      timerIntervalRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev === null || prev <= 1) {
            // Time's up - clear interval and always show answers
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
            }
            
            setShowAnswers(true); // Always show answers when timer expires
            
            // Check if we need to award points for this answer
            if (!hasCheckedAnswer && hasAnswered && isCorrect) {
              setHasCheckedAnswer(true);
              
              // Calculate points based on time taken
              if (answerStartTime && currentPlayerId && getCurrentPlayer()) {
                const timeTakenMs = Date.now() - answerStartTime;
                const timeTakenSeconds = timeTakenMs / 1000;
                const pointsAwarded = calculatePoints(timeTakenSeconds);
                
                // Show points animation
                setPointsEarned(pointsAwarded);
                
                // Trigger confetti for correct answer
                confetti({
                  particleCount: 100,
                  spread: 70,
                  origin: { y: 0.6 }
                });
              }
            }
            
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      // If timer_started_at is not set, this is a new activation
      // Set initial time remaining and start countdown
      setTimeRemaining(activation.time_limit);
      setShowAnswers(false);
      
      // Start countdown timer
      timerIntervalRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev === null || prev <= 1) {
            // Time's up - clear interval and always show answers
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
            }
            
            setShowAnswers(true); // Always show answers when timer expires
            
            // Check if we need to award points for this answer
            if (!hasCheckedAnswer && hasAnswered && isCorrect) {
              setHasCheckedAnswer(true);
              
              // Calculate points based on time taken
              if (answerStartTime && currentPlayerId && getCurrentPlayer()) {
                const timeTakenMs = Date.now() - answerStartTime;
                const timeTakenSeconds = timeTakenMs / 1000;
                const pointsAwarded = calculatePoints(timeTakenSeconds);
                
                // Show points animation
                setPointsEarned(pointsAwarded);
                
                // Trigger confetti for correct answer
                confetti({
                  particleCount: 100,
                  spread: 70,
                  origin: { y: 0.6 }
                });
              }
            }
            
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
  };
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  const initPollVotes = async (activation: Activation) => {
    if (!activation.options) return;

    // Initialize votes object with zeros for all options
    const initialVotes: PollVotes = {};
    activation.options.forEach(option => {
      initialVotes[option.text] = 0;
    });

    setPollVotes(initialVotes);
    setTotalVotes(0);
    setPollState(activation.poll_state || 'pending');
    
    // Fetch existing votes from poll_votes table
    const allVotes = await getPollVotes(activation.id);
    setPollVotes(allVotes);
    setTotalVotes(Object.values(allVotes).reduce((sum, count) => sum + count, 0));
  };

  const handleMultipleChoiceAnswer = async (answer: string) => {
    if (hasAnswered || !activeQuestion) return;
    
    // Check if player has already answered this question
    if (activeQuestion.id && currentPlayerId) {
      const alreadyAnswered = await hasPlayerAnswered(activeQuestion.id, currentPlayerId);
      if (alreadyAnswered) {
        console.log('Player has already answered this question');
        setHasAnswered(true);
        return;
      }
    }
    
    setSelectedAnswer(answer);
    setHasAnswered(true);
    
    try {
      const isCorrectAnswer = answer === activeQuestion.correct_answer;
      setIsCorrect(isCorrectAnswer);
      setShowResult(true);
      
      // Calculate points based on time taken
      let pointsAwarded = 0;
      
      if (isCorrectAnswer && answerStartTime && currentPlayerId && roomId) {
        const timeTakenMs = Date.now() - answerStartTime;
        
        if (debugMode) {
          console.log('Submitting answer with params:', {
            activationId: activeQuestion.id,
            roomId,
            playerId: currentPlayerId,
            playerName: getCurrentPlayer()?.name || 'Unknown',
            isCorrect: isCorrectAnswer,
            timeTakenMs,
            answer
          });
        }
        
        // Submit answer using the API client
        const result = await APIClient.submitAnswer({
          activationId: activeQuestion.id,
          roomId: roomId,
          playerId: currentPlayerId,
          playerName: getCurrentPlayer()?.name || 'Unknown Player',
          isCorrect: isCorrectAnswer,
          timeTakenMs: timeTakenMs,
          answer: answer
        });
        
        if (result.success) {
          pointsAwarded = result.pointsAwarded;
          setPointsEarned(pointsAwarded);
          
          // Update the local player score in the game store with the new score
          if (getCurrentPlayer()) {
            const updatedPlayer = {
              ...getCurrentPlayer()!,
              score: result.newScore
            };
            useGameStore.getState().addPlayer(updatedPlayer);
          }
          
          // Trigger confetti for correct answer if answers are shown
          if (isCorrectAnswer && showAnswers) {
            confetti({
              particleCount: 100,
              spread: 70,
              origin: { y: 0.6 }
            });
          }
          
          if (debugMode) {
            console.log('Points awarded:', pointsAwarded);
            console.log('New score:', result.newScore);
          }
        } else {
          console.error('Error awarding points:', result.error);
        }
      } else {
        // Log analytics event without points
        await supabase.from('analytics_events').insert([{
          event_type: 'question_answer',
          room_id: roomId,
          activation_id: activeQuestion.id,
          user_id: null,
          player_name: getCurrentPlayer()?.name,
          event_data: {
            player_id: currentPlayerId,
            answer: answer,
            is_correct: isCorrectAnswer,
            points_awarded: 0,
            time_taken_ms: answerStartTime ? (Date.now() - answerStartTime) : null
          }
        }]);
      }
      
    } catch (error) {
      console.error('Error processing answer:', error);
    }
  };

  const handleTextAnswerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasAnswered || !activeQuestion || !textAnswer.trim()) return;
    
    // Check if player has already answered this question
    if (activeQuestion.id && currentPlayerId) {
      const alreadyAnswered = await hasPlayerAnswered(activeQuestion.id, currentPlayerId);
      if (alreadyAnswered) {
        console.log('Player has already answered this question');
        setHasAnswered(true);
        return;
      }
    }
    
    try {
      setHasAnswered(true);
      
      // Check if answer is correct (case insensitive)
      const userAnswer = textAnswer.trim().toLowerCase();
      const correctAnswer = activeQuestion.exact_answer?.trim().toLowerCase();
      const isCorrectAnswer = userAnswer === correctAnswer;
      
      setIsCorrect(isCorrectAnswer);
      setShowResult(true);
      
      // Calculate points based on time taken
      let pointsAwarded = 0;
      
      if (isCorrectAnswer && answerStartTime && currentPlayerId && roomId) {
        const timeTakenMs = Date.now() - answerStartTime;
        
        if (debugMode) {
          console.log('Text answer submission params:', {
            activationId: activeQuestion.id,
            roomId,
            playerId: currentPlayerId,
            playerName: getCurrentPlayer()?.name || 'Unknown',
            isCorrect: isCorrectAnswer,
            timeTakenMs,
            answer: textAnswer
          });
        }
        
        // Submit answer using the API client
        const result = await APIClient.submitAnswer({
          activationId: activeQuestion.id,
          roomId: roomId,
          playerId: currentPlayerId,
          playerName: getCurrentPlayer()?.name || 'Unknown Player',
          isCorrect: isCorrectAnswer,
          timeTakenMs: timeTakenMs,
          answer: textAnswer
        });
        
        if (result.success) {
          pointsAwarded = result.pointsAwarded;
          setPointsEarned(pointsAwarded);
          
          // Update the local player score in the game store
          if (getCurrentPlayer()) {
            const updatedPlayer = {
              ...getCurrentPlayer()!,
              score: result.newScore
            };
            useGameStore.getState().addPlayer(updatedPlayer);
          }
          
          if (debugMode) {
            console.log('Text answer points awarded:', pointsAwarded);
            console.log('New score:', result.newScore);  
          }
          
          // Trigger confetti for correct answer if answers are shown
          if (showAnswers && pointsAwarded > 0) {
            confetti({
              particleCount: 100,
              spread: 70,
              origin: { y: 0.6 }
            });
          }
        } else {
          console.error('Error awarding points:', result.error);
        }
      } else {
        // Log analytics event without points
        await supabase.from('analytics_events').insert([{
          event_type: 'question_answer',
          room_id: roomId,
          activation_id: activeQuestion.id,
          user_id: null,
          player_name: getCurrentPlayer()?.name,
          event_data: {
            player_id: currentPlayerId,
            answer: textAnswer,
            is_correct: isCorrectAnswer,
            points_awarded: 0,
            time_taken_ms: answerStartTime ? (Date.now() - answerStartTime) : null
          }
        }]);
      }
      
    } catch (error) {
      console.error('Error processing text answer:', error);
    }
  };

  const handlePollVote = async (answer: string) => {
    // Check if voting is allowed - must be in 'voting' state, not already voted, and poll must be active
    if (pollVoted || !activeQuestion || pollState !== 'voting' || !pollVoteCheckComplete || !currentPlayerId) {
      if (debugMode) {
        console.log('Poll vote blocked:', { 
          pollVoted, 
          pollState, 
          hasActivation: !!activeQuestion,
          pollVoteCheckComplete,
          currentPlayerId 
        });
      }
      return;
    }
    
    try {
      // Double-check if player has already voted in this poll
      const alreadyVoted = await hasPlayerVoted(activeQuestion.id, currentPlayerId);
      if (alreadyVoted) {
        console.log('Player has already voted in this poll');
        setPollVoted(true);
        
        // Get their previous vote
        const playerVote = await getPlayerPollVote(activeQuestion.id, currentPlayerId);
        if (playerVote) {
          setSelectedAnswer(playerVote);
        }
        return;
      }
      
      // Record the vote in the poll_votes table
      const voteRecorded = await recordPollVote(activeQuestion.id, currentPlayerId, answer);
      
      if (!voteRecorded) {
        console.error('Failed to record poll vote');
        return;
      }
      
      setPollVoted(true);
      setSelectedAnswer(answer);
      
      // Update local state optimistically
      const newVotes = { ...pollVotes };
      newVotes[answer] = (newVotes[answer] || 0) + 1;
      setPollVotes(newVotes);
      setTotalVotes(totalVotes + 1);
      
      // Log the vote to analytics
      await supabase.from('analytics_events').insert([{
        event_type: 'poll_vote',
        room_id: roomId,
        activation_id: activeQuestion.id,
        user_id: null,
        player_name: getCurrentPlayer()?.name,
        event_data: {
          player_id: currentPlayerId,
          answer: answer
        }
      }]);
      
      // Broadcast vote to all clients through Supabase channel
      const channel = supabase.channel(`poll-${activeQuestion.id}`);
      await channel.subscribe();
      
      await channel.send({
        type: 'broadcast',
        event: 'poll-vote',
        payload: { votes: newVotes }
      });
      
      // Clean up
      setTimeout(() => {
        channel.unsubscribe();
      }, 1000);
      
    } catch (error) {
      console.error('Error processing poll vote:', error);
      // Revert optimistic update on error
      setPollVoted(false);
      setSelectedAnswer('');
    }
  };

  const toggleLeaderboard = () => {
    setShowLeaderboard(!showLeaderboard);
  };

  const renderAnswerResult = () => {
    if (!showResult || !showAnswers) return null;
    
    return (
      <div className={`
        mt-4 p-4 rounded-lg text-center transform transition-all duration-300 ease-out animate-pop-in
        ${isCorrect
          ? 'bg-green-100 text-green-800'
          : 'bg-red-100 text-red-800'
        }
      `}>
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          {isCorrect ? (
            <>
              <CheckCircle className="w-5 h-5" />
              <span>Correct Answer!</span>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5" />
              <span>Wrong Answer</span>
            </>
          )}
        </div>
        {!isCorrect && activeQuestion?.type === 'multiple_choice' && showAnswers && (
          <p className="text-sm mt-1 opacity-90">
            The correct answer was: <span className="font-medium">{activeQuestion.correct_answer}</span>
          </p>
        )}
        {!isCorrect && activeQuestion?.type === 'text_answer' && showAnswers && (
          <p className="text-sm mt-1 opacity-90">
            The correct answer was: <span className="font-medium">{activeQuestion.exact_answer}</span>
          </p>
        )}
      </div>
    );
  };
  
  const getColorForIndex = (index: number, theme?: any) => {
    // Use theme colors if available
    if (theme) {
      const baseColors = [
        theme.primary_color || '#3B82F6',
        theme.secondary_color || '#8B5CF6',
        theme.success_color || '#10B981',
        theme.warning_color || '#F59E0B',
        theme.error_color || '#EF4444',
        '#06B6D4', // Cyan
        '#8B5CF6', // Purple
        '#EC4899', // Pink
        '#F97316', // Orange
        '#14B8A6', // Teal
      ];
      return base