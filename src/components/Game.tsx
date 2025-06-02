import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { Trophy, Settings, CheckCircle, XCircle, Users, Send, Clock, PlayCircle, X, Lock, WifiOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { subscribeToRoomUpdates, subscribeToPollVotes, getPollVotes } from '../lib/realtime';
import confetti from 'canvas-confetti';
import { useTheme } from '../context/ThemeContext';
import CountdownTimer from './ui/CountdownTimer';
import PointAnimation from './ui/PointAnimation';
import PointsDisplay from './ui/PointsDisplay';
import { calculatePoints, POINT_CONFIG } from '../lib/point-calculator';
import LeaderboardItem from './ui/LeaderboardItem';
import { distributePoints, hasPlayerAnswered, hasPlayerVoted, getPlayerPollVote } from '../lib/point-distribution';
import PollStateIndicator from './ui/PollStateIndicator';
import PollDisplay from './ui/PollDisplay';

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

  // Check poll vote status whenever activeQuestion changes
  useEffect(() => {
    const checkPollVoteStatus = async () => {
      if (activeQuestion?.type === 'poll' && activeQuestion.id && currentPlayerId) {
        try {
          const hasVoted = await hasPlayerVoted(activeQuestion.id, currentPlayerId);
          setPollVoted(hasVoted);
          
          if (hasVoted) {
            // Get the actual vote they made
            const playerVote = await getPlayerPollVote(activeQuestion.id, currentPlayerId);
            if (playerVote) {
              setSelectedAnswer(playerVote);
            }
          }
        } catch (err) {
          console.error("Error checking player's poll vote:", err);
        }
      }
    };
    
    checkPollVoteStatus();
  }, [activeQuestion?.id, activeQuestion?.type, currentPlayerId]);

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
        setPointsEarned(0);
        setAnswerStartTime(null);
        setHasCheckedAnswer(false);
        
        // Don't reset pollVoted here - we'll check it properly below

        // Handle the poll activation
        if (activation?.type === 'poll') {
          await initPollVotes(activation);
          setPollState(activation.poll_state || 'pending');
          
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
          // Reset poll voted state only when switching away from a poll
          setPollVoted(false);
        }
        
        // Setup timer if needed
        setupTimer(activation);
        
        // Set answer start time for point calculation
        if (activation && (activation.type === 'multiple_choice' || activation.type === 'text_answer')) {
          setAnswerStartTime(Date.now());
        }

        // Check if player has already voted for this poll
        if (activation?.type === 'poll' && activation.id && currentPlayerId) {
          try {
            const hasVoted = await hasPlayerVoted(activation.id, currentPlayerId);
            setPollVoted(hasVoted);
            
            if (hasVoted) {
              // Get the actual vote they made
              const playerVote = await getPlayerPollVote(activation.id, currentPlayerId);
              if (playerVote) {
                setSelectedAnswer(playerVote);
              }
            }
          } catch (err) {
            console.error("Error checking player's poll vote:", err);
          }
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
    
    // Fetch existing votes from analytics
    const allVotes = await getPollVotes(activation.id);
    setPollVotes(allVotes);
    setTotalVotes(Object.values(allVotes).reduce((sum, count) => sum + count, 0));
    
    // Check if current player has already voted
    if (currentPlayerId) {
      const hasVoted = await hasPlayerVoted(activation.id, currentPlayerId);
      setPollVoted(hasVoted);
      
      if (hasVoted) {
        const playerVote = await getPlayerPollVote(activation.id, currentPlayerId);
        if (playerVote) {
          setSelectedAnswer(playerVote);
        }
      }
    }
  };
  
  const fetchPollVotes = async (activationId: string) => {
    try {
      console.log(`Fetching poll votes for activation ${activationId}`);
      const { data, error } = await supabase
        .from('analytics_events')
        .select('event_data')
        .eq('event_type', 'poll_vote')
        .eq('activation_id', activationId);
        
      if (error) throw error;
      
      if (data && data.length > 0) {
        // Count votes
        const votes: PollVotes = {};
        const activation = activeQuestion;
        activation?.options?.forEach(option => {
          votes[option.text] = 0;
        });
        
        data.forEach(event => {
          const answer = event.event_data?.answer;
          if (answer && votes[answer] !== undefined) {
            votes[answer]++;
          }
        });
        
        setPollVotes(votes);
        setTotalVotes(data.length);
        
        if (debugMode) {
          console.log(`Fetched ${data.length} poll votes for activation ${activationId}`);
          console.log('Vote counts:', votes);
        }
        
        // Check if current player has already voted
        if (currentPlayerId) {
          const hasVoted = await hasPlayerVoted(activationId, currentPlayerId);
          setPollVoted(hasVoted);
          
          // If they've voted, find what they voted for
          if (hasVoted) {
            const { data: playerVote } = await supabase
              .from('analytics_events')
              .select('event_data')
              .eq('event_type', 'poll_vote')
              .eq('activation_id', activationId)
              .filter('event_data->player_id', 'eq', currentPlayerId)
              .single();
              
            if (playerVote?.event_data?.answer) {
              setSelectedAnswer(playerVote.event_data.answer);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error fetching poll votes:', err);
    }
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
          console.log('Distributing points with params:', {
            activationId: activeQuestion.id,
            roomId,
            playerId: currentPlayerId,
            playerName: getCurrentPlayer()?.name || 'Unknown',
            isCorrect: isCorrectAnswer,
            timeTakenMs,
            answer
          });
        }
        
        // Distribute points using the point distribution system
        const result = await distributePoints({
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
          console.log('Text answer distribution params:', {
            activationId: activeQuestion.id,
            roomId,
            playerId: currentPlayerId,
            playerName: getCurrentPlayer()?.name || 'Unknown',
            isCorrect: isCorrectAnswer,
            timeTakenMs,
            answer: textAnswer
          });
        }
        
        // Distribute points using the point distribution system
        const result = await distributePoints({
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
    if (pollVoted || !activeQuestion || pollState !== 'voting') {
      return;
    }
    
    try {
      // Double-check if player has already voted in this poll
      if (currentPlayerId) {
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
      }
      
      setPollVoted(true);
      setSelectedAnswer(answer);
      
      // Update local state
      const newVotes = { ...pollVotes };
      newVotes[answer] = (newVotes[answer] || 0) + 1;
      setPollVotes(newVotes);
      setTotalVotes(totalVotes + 1);
      
      // Log the vote to the database first to ensure persistence
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
      return baseColors[index % baseColors.length];
    }
    
    // Fallback colors
    const colors = [
      '#3B82F6', // Blue
      '#10B981', // Green
      '#F59E0B', // Yellow
      '#8B5CF6', // Purple
      '#EC4899', // Pink
      '#6366F1'  // Indigo
    ];
    return colors[index % colors.length];
  };
  
  const renderMediaContent = () => {
    if (!activeQuestion?.media_url || activeQuestion.media_type === 'none') return null;
    
    switch (activeQuestion.media_type) {
      case 'image':
      case 'gif':
        return (
          <div className="flex justify-center items-center mb-4">
            <div className="rounded-lg shadow-sm bg-gray-100 p-1 overflow-hidden inline-block">
              <img 
                src={getStorageUrl(activeQuestion.media_url)} 
                alt="Question media" 
                className="max-h-40 object-contain"
                onError={(e) => {
                  console.error('Error loading image:', activeQuestion.media_url);
                  e.currentTarget.src = 'https://via.placeholder.com/400x300?text=Image+Preview';
                }}
              />
            </div>
          </div>
        );
      case 'youtube':
        const videoId = activeQuestion.media_url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/)?.[1];
        return videoId ? (
          <div className="flex justify-center items-center mb-4">
            <div className="w-full max-w-md rounded-lg shadow-sm overflow-hidden">
              <div className="aspect-video max-h-40">
                <iframe
                  className="w-full h-full"
                  src={`https://www.youtube.com/embed/${videoId}`}
                  allowFullScreen
                />
              </div>
            </div>
          </div>
        ) : null;
      default:
        return null;
    }
  };

  // Debug panel
  const renderDebugPanel = () => {
    if (!debugMode) return null;
    
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-black/80 text-white p-2 text-xs font-mono z-50 max-h-40 overflow-auto">
        <div className="flex justify-between mb-1">
          <span className="font-bold">DEBUG MODE</span>
          <button onClick={() => setDebugMode(false)} className="text-red-400">Close</button>
        </div>
        <div>Player ID: {currentPlayerId}</div>
        <div>Player Name: {currentPlayer?.name}</div>
        <div>Score: {currentPlayer?.score}</div>
        <div>Stats: {JSON.stringify(currentPlayer?.stats)}</div>
        <div>Room ID: {roomId}</div>
        <div>Current Activation: {currentActivation?.substring(0, 8)}...</div>
        <div>Media Type: {activeQuestion?.media_type || 'None'}</div>
        <div>Media URL: {activeQuestion?.media_url ? getStorageUrl(activeQuestion.media_url) : 'None'}</div>
        <div>Has Answered: {hasAnswered ? 'Yes' : 'No'}</div>
        <div>Is Correct: {isCorrect ? 'Yes' : 'No'}</div>
        <div>Points Earned: {pointsEarned}</div>
        <div>Answer Start Time: {answerStartTime ? new Date(answerStartTime).toISOString() : 'None'}</div>
        <div>Poll Votes: {JSON.stringify(pollVotes)}</div>
        <div>Poll State: {pollState}</div>
        <div>Poll Voted: {pollVoted ? 'Yes' : 'No'}</div>
        <div>Selected Answer: {selectedAnswer}</div>
      </div>
    );
  };

  // Get active theme from room or default
  const activeTheme = room?.theme || theme;

  if (networkError) {
    return (
      <div 
        className="flex flex-col items-center justify-center min-h-screen p-4 bg-theme-gradient"
        style={{ 
          background: `linear-gradient(to bottom right, ${activeTheme.primary_color}, ${activeTheme.secondary_color})` 
        }}
      >
        <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <WifiOff className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Network Error</h1>
          <p className="text-gray-600 mb-6">Unable to connect to the server. Please check your internet connection.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 text-white rounded-lg transition"
            style={{ backgroundColor: activeTheme.primary_color }}
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!currentPlayer) {
    return (
      <div 
        className="flex flex-col items-center justify-center min-h-screen p-4 bg-theme-gradient"
        style={{ 
          background: `linear-gradient(to bottom right, ${activeTheme.primary_color}, ${activeTheme.secondary_color})` 
        }}
      >
        <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Join a Room</h1>
          <p className="text-white/70 mb-6">You need to join a room to play.</p>
          <button
            onClick={() => navigate('/join')}
            className="px-6 py-3 text-white rounded-lg transition"
            style={{ backgroundColor: activeTheme.primary_color }}
          >
            Join a Room
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen p-4 bg-theme-gradient"
      style={{ 
        background: `linear-gradient(to bottom right, ${activeTheme.primary_color}, ${activeTheme.secondary_color})` 
      }}
    >
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-4 mb-4 flex items-center justify-between">
          <div className="flex items-center">
            <div 
              className="w-10 h-10 rounded-full flex items-center justify-center font-bold mr-3"
              style={{ backgroundColor: `${activeTheme.primary_color}40` }}
            >
              {currentPlayer.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">{currentPlayer.name}</h1>
              <div className="text-sm text-white/80 flex items-center">
                <PointsDisplay points={currentPlayer.score || 0} />
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={toggleLeaderboard}
              className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
              title="Leaderboard"
            >
              <Trophy className="w-5 h-5" />
            </button>
            <button
              onClick={() => setDebugMode(!debugMode)}
              className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
              title={debugMode ? "Hide Debug Info" : "Show Debug Info"}
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* Active Question */}
        {activeQuestion ? (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-6 mb-4 text-white relative">
            {/* Points animation */}
            {pointsEarned > 0 && (
              <PointAnimation 
                points={pointsEarned} 
                className="absolute top-2 right-2"
              />
            )}
            
            {/* Timer Display */}
            {activeQuestion.time_limit && activeQuestion.timer_started_at && (
              <div className="mb-4 flex justify-center">
                <CountdownTimer 
                  initialSeconds={activeQuestion.time_limit}
                  startTime={activeQuestion.timer_started_at}
                  variant="large"
                  onComplete={() => {
                    if (activeQuestion.type === 'poll') {
                      // For polls, just show the results when timer expires
                      setPollVoted(true);
                    } else {
                      // For questions, show the answers
                      setShowAnswers(true);
                    }
                  }}
                />
              </div>
            )}
            
            {/* Poll State Indicator */}
            {activeQuestion.type === 'poll' && (
              <div className="mb-4 flex justify-center">
                <PollStateIndicator state={pollState} />
              </div>
            )}
            
            <h2 className="text-xl font-semibold mb-4">{activeQuestion.question}</h2>
            
            {renderMediaContent()}
            
            {/* Multiple Choice Question */}
            {activeQuestion.type === 'multiple_choice' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {activeQuestion.options?.map((option, index) => {
                  const isSelected = option.text === selectedAnswer;
                  const isCorrect = option.text === activeQuestion.correct_answer;
                  const showCorrect = hasAnswered && showAnswers && isCorrect;
                  const showIncorrect = hasAnswered && showAnswers && isSelected && !isCorrect;
                  
                  return (
                    <button
                      key={index}
                      onClick={() => handleMultipleChoiceAnswer(option.text)}
                      disabled={hasAnswered}
                      className={`
                        relative p-3 rounded-xl text-left transition 
                        ${hasAnswered
                          ? showCorrect
                            ? 'bg-green-400/30 ring-2 ring-green-400'
                            : showIncorrect
                              ? 'bg-red-400/30 ring-2 ring-red-400'
                              : isSelected
                                ? 'bg-blue-400/30 ring-2 ring-blue-400'
                                : 'bg-white/20'
                          : 'bg-white/20 hover:bg-white/30'
                        }
                      `}
                    >
                      <div className="flex items-center gap-3">
                        {option.media_type !== 'none' && option.media_url && (
                          <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 bg-black/20">
                            <img
                              src={option.media_url}
                              alt={option.text}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.src = 'https://via.placeholder.com/100?text=!';
                              }}
                            />
                          </div>
                        )}
                        <div className="flex-1 font-medium truncate">{option.text}</div>
                      </div>
                      
                      {showCorrect && (
                        <div className="absolute -top-2 -right-2">
                          <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                            <CheckCircle className="w-4 h-4 text-white" />
                          </div>
                        </div>
                      )}
                      {showIncorrect && (
                        <div className="absolute -top-2 -right-2">
                          <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
                            <XCircle className="w-4 h-4 text-white" />
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            
            {/* Text Answer Question */}
            {activeQuestion.type === 'text_answer' && (
              <form onSubmit={handleTextAnswerSubmit} className="space-y-4">
                <div className="bg-white/20 p-4 rounded-lg">
                  <input
                    type="text"
                    value={textAnswer}
                    onChange={(e) => setTextAnswer(e.target.value)}
                    placeholder="Type your answer here..."
                    disabled={hasAnswered}
                    className={`w-full px-4 py-3 bg-white/10 border ${
                      hasAnswered 
                        ? showResult 
                          ? isCorrect 
                            ? 'border-green-400' 
                            : 'border-red-400' 
                          : 'border-white/30' 
                        : 'border-white/30'
                    } rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50`}
                  />
                </div>
                
                {!hasAnswered && (
                  <button
                    type="submit"
                    disabled={!textAnswer.trim()}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: activeTheme.primary_color }}
                  >
                    <Send className="w-4 h-4" />
                    Submit Answer
                  </button>
                )}
                
                {showResult && renderAnswerResult()}
              </form>
            )}
            
            {/* Poll Question */}
            {activeQuestion.type === 'poll' && (
              <div className="mt-4">
                {!pollVoted && pollState === 'voting' ? (
                  <div className="grid grid-cols-1 gap-3">
                    {activeQuestion.options?.map((option, index) => (
                      <button
                        key={index}
                        onClick={() => handlePollVote(option.text)}
                        disabled={pollVoted || pollState !== 'voting'}
                        className={`p-4 rounded-xl text-left transition hover:bg-white/30 bg-white/20 ${
                          pollState !== 'voting' ? 'cursor-not-allowed opacity-70' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {option.media_type !== 'none' && option.media_url && (
                            <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-black/20">
                              <img
                                src={getStorageUrl(option.media_url)}
                                alt={option.text}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  console.error('Error loading option image:', option.media_url);
                                  e.currentTarget.src = 'https://via.placeholder.com/100?text=!';
                                }}
                              />
                            </div>
                          )}
                          <div className="flex-1 font-medium">{option.text}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className={pollState === 'pending' ? "p-4 bg-yellow-100/20 rounded-lg text-center" : ""}>
                    {pollState === 'pending' ? (
                      <div className="flex flex-col items-center gap-3">
                        <Clock className="w-8 h-8 text-yellow-300" />
                        <p className="text-lg font-medium">Waiting for voting to begin</p>
                        <p className="text-sm opacity-80">The host will start the voting soon</p>
                      </div>
                    ) : (
                      <PollDisplay 
                        options={activeQuestion.options || []}
                        votes={pollVotes}
                        totalVotes={totalVotes}
                        displayType={activeQuestion.poll_display_type || 'bar'}
                        resultFormat={activeQuestion.poll_result_format || 'both'}
                        selectedAnswer={selectedAnswer}
                        getStorageUrl={getStorageUrl}
                        themeColors={{
                          primary_color: activeTheme.primary_color,
                          secondary_color: activeTheme.secondary_color
                        }}
                      />
                    )}
                  </div>
                )}
                
                {pollState === 'pending' && (
                  <div className="mt-3 bg-white/10 p-3 rounded-lg text-center text-sm">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <Lock className="w-4 h-4" />
                      <span>Voting is not active yet</span>
                    </div>
                    <p>Please wait for the host to start the voting.</p>
                  </div>
                )}
              </div>
            )}
            
            {activeQuestion.type === 'leaderboard' && (
              <div className="text-center p-4 bg-white/10 rounded-lg">
                <p className="text-white">
                  The leaderboard is displayed on the main screen.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-8 mb-4 text-center">
            <PlayCircle className="w-16 h-16 text-white/50 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">Waiting for the next question</h2>
            <p className="text-white/80">
              The host will start a new question soon. Get ready!
            </p>
          </div>
        )}
        
        {/* Leaderboard */}
        {showLeaderboard && (
          <div 
            ref={leaderboardRef}
            className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-6 mb-4 animate-pop-in"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center">
                <Trophy className="w-5 h-5 text-yellow-300 mr-2" />
                Leaderboard
              </h2>
              <button
                onClick={toggleLeaderboard}
                className="p-1 text-white/70 hover:text-white rounded-full hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {[currentPlayer, ...otherPlayers]
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .map((player, index) => (
                  <LeaderboardItem
                    key={player.id}
                    player={player}
                    rank={index + 1}
                    previousRank={previousRankings[player.id]}
                    isCurrentPlayer={player.id === currentPlayerId}
                    showStats={true}
                  />
                ))}
                
              {otherPlayers.length === 0 && (
                <div className="text-center py-4 text-white/70">
                  No other players have joined yet
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {renderDebugPanel()}
    </div>
  );
}