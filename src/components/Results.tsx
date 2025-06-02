import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Trophy, RefreshCw, Users, Clock, Lock, PlayCircle, AlertCircle, WifiOff } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import CountdownTimer from './ui/CountdownTimer';
import LeaderboardItem from './ui/LeaderboardItem';
import { formatPoints } from '../lib/point-calculator';
import LeaderboardDisplay from './ui/LeaderboardDisplay';
import confetti from 'canvas-confetti';
import PollStateIndicator from './ui/PollStateIndicator';
import PollDisplay from './ui/PollDisplay';
import QRCodeDisplay from './ui/QRCodeDisplay';
import { hasPlayerVoted, getPollVotes } from '../lib/point-distribution';
import { subscribeToPollVotes } from '../lib/realtime';

// Helper function to extract YouTube video ID from various URL formats
const extractYoutubeVideoId = (url: string): string | null => {
  if (!url) return null;
  
  // Handle different YouTube URL formats
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
};

interface Player {
  id: string;
  name: string;
  score: number;
  stats?: {
    totalPoints: number;
    correctAnswers: number;
    totalAnswers: number;
    averageResponseTimeMs: number;
  };
}

interface Option {
  text: string;
  media_type: 'none' | 'image' | 'gif';
  media_url: string;
}

interface Activation {
  id: string;
  type: 'multiple_choice' | 'text_answer' | 'poll' | 'social_wall' | 'leaderboard';
  question: string;
  options?: Option[];
  correct_answer?: string;
  exact_answer?: string;
  media_type: 'none' | 'image' | 'youtube' | 'gif';
  media_url?: string;
  poll_display_type?: 'bar' | 'pie' | 'horizontal' | 'vertical';
  poll_state?: 'pending' | 'voting' | 'closed';
  poll_result_format?: 'percentage' | 'votes' | 'both';
  title?: string;
  description?: string;
  category?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  tags?: string[];
  is_public?: boolean;
  theme?: {
    primary_color: string;
    secondary_color: string;
    background_color: string;
    text_color: string;
    container_bg_color?: string;
  };
  logo_url?: string;
  max_players?: number;
  time_limit?: number;
  timer_started_at?: string;
  show_answers?: boolean;
}

interface PollVotes {
  [key: string]: number;
}

export default function Results() {
  const { code } = useParams<{ code: string }>();
  const { theme: globalTheme } = useTheme();
  const [room, setRoom] = useState<any>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentActivation, setCurrentActivation] = useState<Activation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollVotes, setPollVotes] = useState<PollVotes>({});
  const [totalVotes, setTotalVotes] = useState(0);
  const [networkError, setNetworkError] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [pollState, setPollState] = useState<'pending' | 'voting' | 'closed'>('pending');
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollSubscriptionRef = useRef<(() => void) | null>(null);
  const [playerRankings, setPlayerRankings] = useState<{[key: string]: number}>({});
  const [previousRankings, setPreviousRankings] = useState<{[key: string]: number}>({});
  const [previousActivationType, setPreviousActivationType] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [activationRefreshCount, setActivationRefreshCount] = useState(0);
  const activationChannelRef = useRef<any>(null);
  
  // Toggle debug mode with key sequence
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

  // Fetch room data when code changes
  useEffect(() => {
    if (!code) return;
    
    const fetchRoom = async () => {
      try {
        setLoading(true);
        
        // Get room by code
        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .select('*')
          .eq('room_code', code)
          .single();
          
        if (roomError) throw roomError;
        
        setRoom(roomData);
        
        // Get players for this room
        const { data: playerData, error: playerError } = await supabase
          .from('players')
          .select('id, name, score, stats, room_id')
          .eq('room_id', roomData.id)
          .order('score', { ascending: false });
          
        if (playerError) throw playerError;
        
        if (debugMode) {
          console.log('Fetched players data:', playerData);
        }
        
        setPlayers(Array.isArray(playerData) ? playerData : []);
        
        // Update rankings
        updateRankings(playerData || []);
        
        // Get current activation
        const { data: sessionData, error: sessionError } = await supabase
          .from('game_sessions')
          .select('current_activation')
          .eq('room_id', roomData.id)
          .maybeSingle();
          
        if (sessionError) throw sessionError;
        
        if (sessionData?.current_activation) {
          const { data: activation, error: activationError } = await supabase
            .from('activations')
            .select('*')
            .eq('id', sessionData.current_activation)
            .single();
              
          if (activationError) throw activationError;
          
          await handleActivationChange(activation);
        } else {
          await handleActivationChange(null);
        }
        
        setLoading(false);
        
        // Set up real-time subscriptions
        setupRealtimeSubscriptions(roomData.id);
        
      } catch (err) {
        console.error('Error fetching room:', err);
        setError('Failed to load room data');
        setLoading(false);
      }
    };
    
    fetchRoom();
    
    // Clean up function
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (pollSubscriptionRef.current) {
        pollSubscriptionRef.current();
        pollSubscriptionRef.current = null;
      }
    };
  }, [code, debugMode, activationRefreshCount]);
  
  // Handle activation change
  const handleActivationChange = async (activation: Activation | null) => {
    if (debugMode) {
      console.log('Handling activation change:', activation);
    }
    
    // Store previous activation type before updating
    setPreviousActivationType(currentActivation?.type || null);
    
    setCurrentActivation(activation);
    
    // Clean up any existing subscriptions
    if (pollSubscriptionRef.current) {
      pollSubscriptionRef.current();
      pollSubscriptionRef.current = null;
    }
    
    // Clear timer
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    if (activation) {
      // If it's a poll, set up poll-specific subscriptions
      if (activation.type === 'poll' && activation.options) {
        await initPollVotes(activation);
        setPollState(activation.poll_state || 'pending');
        
        // Set up poll subscription
        const cleanup = subscribeToPollVotes(
          activation.id, 
          (votes) => {
            console.log("Results page poll votes updated:", votes);
            setPollVotes(votes);
            setTotalVotes(Object.values(votes).reduce((sum, count) => sum + count, 0));
          },
          (state) => {
            console.log("Results page poll state changed:", state);
            setPollState(state);
          }
        );
        pollSubscriptionRef.current = cleanup;
      }
      
      // Setup timer if needed
      if (activation.time_limit && activation.timer_started_at) {
        setupTimer(activation);
      } else {
        setShowAnswers(activation.show_answers !== false);
      }
    } else {
      // No activation
      setTimeRemaining(null);
      setShowAnswers(false);
      setPollVotes({});
      setTotalVotes(0);
      setPollState('pending');
    }
  };
  
  // Update player rankings
  const updateRankings = (playerData: Player[]) => {
    // Save previous rankings before updating
    if (Object.keys(playerRankings).length > 0) {
      setPreviousRankings(playerRankings);
    }
    
    // Update current rankings
    const newRanks: {[key: string]: number} = {};
    if (Array.isArray(playerData)) {
      playerData
        .sort((a, b) => b.score - a.score)
        .forEach((player, index) => {
          newRanks[player.id] = index + 1;
        });
    }
    setPlayerRankings(newRanks);
  };
  
  // Setup timer when activation changes or timer starts
  const setupTimer = (activation: Activation) => {
    // Clear any existing timer
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    // Reset timer state
    setTimeRemaining(null);
    setShowAnswers(false); // Default to hiding answers
    
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
            
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
  };
  
  // Set up real-time subscriptions
  const setupRealtimeSubscriptions = (roomId: string) => {
    // Subscribe to game session changes
    const gameSession = supabase
      .channel(`game_session_${roomId}`)
      .on('postgres_changes', {
        event: '*', 
        schema: 'public',
        table: 'game_sessions',
        filter: `room_id=eq.${roomId}`
      }, async (payload) => {
        console.log('Game session change detected:', payload);
        
        if (payload.new && payload.old && payload.new.current_activation !== payload.old.current_activation) {
          if (payload.new?.current_activation) {
            // Refresh the activation data
            setActivationRefreshCount(count => count + 1);
          } else {
            // Clear current activation
            setPreviousActivationType(currentActivation?.type || null);
            setCurrentActivation(null);
            
            // Clear any active timer
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
            }
            
            // Unsubscribe from poll channel if active
            if (pollSubscriptionRef.current) {
              pollSubscriptionRef.current();
              pollSubscriptionRef.current = null;
            }
          }
        }
      })
      .subscribe();

    // Subscribe to activation updates (for poll state changes)
    activationChannelRef.current = supabase
      .channel(`activation_updates_${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'activations',
        filter: `room_id=eq.${roomId}`
      }, async (payload) => {
        if (currentActivation && payload.new.id === currentActivation.id) {
          console.log('Current activation updated:', payload.new);
          await handleActivationChange(payload.new);
        }
      })
      .subscribe();

    // Subscribe to player changes
    const playerChannel = supabase
      .channel(`players_${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'players',
        filter: `room_id=eq.${roomId}`
      }, async () => {
        try {
          const { data, error } = await supabase
            .from('players')
            .select('id, name, score, room_id, stats')
            .eq('room_id', roomId)
            .order('score', { ascending: false });
            
          if (error) {
            console.error('Error fetching players:', error);
            return;
          }
          
          // Ensure data is an array
          const playerData = Array.isArray(data) ? data : [];
          
          updateRankings(playerData);
          setPlayers(playerData);
        } catch (error) {
          console.error('Error in player changes handler:', error);
        }
      })
      .subscribe();
      
    // Return cleanup function
    return () => {
      gameSession.unsubscribe();
      playerChannel.unsubscribe();
      if (activationChannelRef.current) {
        activationChannelRef.current.unsubscribe();
      }
    };
  };

  const initPollVotes = async (activation: Activation) => {
    if (!activation.options) return;
    
    // Initialize votes object with zeros for all options
    const votes: PollVotes = {};
    activation.options.forEach(option => {
      votes[option.text] = 0;
    });
    
    setPollVotes(votes);
    setTotalVotes(0);
    setPollState(activation.poll_state || 'pending');
    
    // Fetch existing votes from analytics
    const allVotes = await getPollVotes(activation.id);
    setPollVotes(allVotes);
    setTotalVotes(Object.values(allVotes).reduce((sum, count) => sum + count, 0));
  };
  
  const renderMediaContent = () => {
    if (!currentActivation?.media_url || currentActivation.media_type === 'none') {
      if (debugMode) {
        console.log('No media to render:', currentActivation?.media_type, currentActivation?.media_url);
      }
      return null;
    }
    
    if (debugMode) {
      console.log('Rendering media:', {
        type: currentActivation.media_type,
        url: currentActivation.media_url
      });
    }
    
    switch (currentActivation.media_type) {
      case 'image':
      case 'gif':
        return (
          <div className="flex justify-center items-center mb-4">
            <div className="rounded-lg shadow-sm bg-gray-100 p-1 overflow-hidden inline-block">
              <img 
                src={currentActivation.media_url} 
                alt="Question media" 
                className="max-h-40 object-contain"
                onError={(e) => {
                  e.currentTarget.src = 'https://via.placeholder.com/400x300?text=Image+Preview';
                }}
              />
            </div>
          </div>
        );
      case 'youtube':
        const videoId = extractYoutubeVideoId(currentActivation.media_url);
        
        if (debugMode) {
          console.log('YouTube video ID:', videoId);
        }
        
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
        ) : (
          <div className="p-3 bg-red-100/20 text-white rounded-lg text-center mb-4">
            Invalid YouTube URL: {currentActivation.media_url}
          </div>
        );
      default:
        if (debugMode) {
          console.log('Unknown media type:', currentActivation.media_type);
        }
        return null;
    }
  };

  // Get room theme or use default theme
  const activeTheme = room?.theme || globalTheme;

  // Add effect for confetti when leaderboard is activated
  useEffect(() => {
    // Check if the activation type has changed to leaderboard
    if (currentActivation?.type === 'leaderboard' && previousActivationType !== 'leaderboard') {
      // Fire confetti when leaderboard is activated
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.3 }
      });

      // Add a secondary delayed burst for more excitement
      setTimeout(() => {
        confetti({
          particleCount: 100,
          angle: 60,
          spread: 55,
          origin: { x: 0.1, y: 0.5 }
        });
        
        confetti({
          particleCount: 100,
          angle: 120,
          spread: 55,
          origin: { x: 0.9, y: 0.5 }
        });
      }, 500);
    }
  }, [currentActivation, previousActivationType]);

  // Generate QR code URL for this room
  const getJoinUrl = () => {
    try {
      const baseUrl = window.location.origin;
      return `${baseUrl}/join?code=${room?.room_code || code}`;
    } catch (err) {
      console.error('Error generating join URL:', err);
      return `/join?code=${room?.room_code || code}`;
    }
  };

  if (debugMode) {
    console.log('Current state:', {
      room,
      players: players.length,
      currentActivation: currentActivation?.id,
      activationType: currentActivation?.type,
      showAnswers,
      pollState,
      pollVotes,
      totalVotes
    });
  }

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

  if (loading) {
    return (
      <div 
        className="flex flex-col items-center justify-center min-h-screen p-4 bg-theme-gradient"
        style={{ 
          background: `linear-gradient(to bottom right, ${activeTheme.primary_color}, ${activeTheme.secondary_color})` 
        }}
      >
        <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
        <p className="mt-4 text-white text-xl">Loading...</p>
      </div>
    );
  }

  if (error || !room) {
    return (
      <div 
        className="flex flex-col items-center justify-center min-h-screen p-4 bg-theme-gradient"
        style={{ 
          background: `linear-gradient(to bottom right, ${activeTheme.primary_color}, ${activeTheme.secondary_color})` 
        }}
      >
        <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Error</h1>
          <p className="text-gray-600 mb-6">{error || "Room not found"}</p>
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
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            {room.logo_url && (
              <img 
                src={room.logo_url} 
                alt={room.name} 
                className="h-12 w-auto object-contain mr-4"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
            <h1 className="text-2xl font-bold text-white">{room.name}</h1>
          </div>
          <div className="bg-white/20 px-3 py-1 rounded-full text-white text-sm">
            Room {room.room_code}
          </div>
        </div>
        
        {/* Current Activation */}
        {currentActivation ? (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-6 mb-6">
            {/* Timer Display */}
            {currentActivation.time_limit && currentActivation.timer_started_at && (
              <div className="mb-4 flex justify-center">
                <CountdownTimer 
                  initialSeconds={currentActivation.time_limit}
                  startTime={currentActivation.timer_started_at}
                  variant="large"
                  onComplete={() => setShowAnswers(true)}
                  showProgressBar={true}
                />
              </div>
            )}
            
            {currentActivation.type === 'leaderboard' ? (
              <LeaderboardDisplay 
                roomId={room.id}
                maxPlayers={currentActivation.max_players || 20}
                autoRefresh={true}
                refreshInterval={5000}
                showStats={true}
              />
            ) : (
              <>
                <h2 className="text-xl font-semibold text-white mb-4">{currentActivation.question}</h2>
                
                {renderMediaContent()}
                
                {/* Multiple Choice Question */}
                {currentActivation.type === 'multiple_choice' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {currentActivation.options?.map((option, index) => {
                      const isCorrect = option.text === currentActivation.correct_answer;
                      
                      return (
                        <div
                          key={index}
                          className={`p-4 rounded-xl text-left transition ${
                            showAnswers && isCorrect
                              ? 'bg-green-400/30 ring-2 ring-green-400'
                              : 'bg-white/20'
                          }`}
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
                            <div className="flex-1 font-medium text-white">{option.text}</div>
                          </div>
                          
                          {showAnswers && isCorrect && (
                            <div className="mt-2 text-sm text-green-200">
                              Correct Answer
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {/* Text Answer Question */}
                {currentActivation.type === 'text_answer' && (
                  <div className="bg-white/20 p-4 rounded-lg">
                    {showAnswers ? (
                      <div className="transition-all duration-500 ease-in-out transform">
                        <div className="text-white mb-2">Correct Answer:</div>
                        <div className="bg-green-400/30 p-3 rounded-lg text-white font-medium">
                          {currentActivation.exact_answer}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-white py-3">
                        <p className="text-lg font-medium mb-2">
                          The answer will be revealed when the timer expires
                        </p>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Poll Question */}
                {currentActivation.type === 'poll' && (
                  <>
                    {/* Poll State Indicator */}
                    <div className="mb-4 flex justify-center">
                      <PollStateIndicator state={pollState} size="lg" />
                    </div>
                    
                    <PollDisplay 
                      options={currentActivation.options || []}
                      votes={pollVotes}
                      totalVotes={totalVotes}
                      displayType={currentActivation.poll_display_type || 'bar'}
                      resultFormat={currentActivation.poll_result_format || 'both'}
                      themeColors={{
                        primary_color: currentActivation.theme?.primary_color || room.theme?.primary_color || globalTheme.primary_color,
                        secondary_color: currentActivation.theme?.secondary_color || room.theme?.secondary_color || globalTheme.secondary_color
                      }}
                    />
                  </>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-8 mb-6 text-center">
            <QRCodeDisplay 
              value={getJoinUrl()}
              title="Join the Experience"
              subtitle={room.settings?.results_page_message || "Scan the QR code to join the fun!"}
              logoUrl={room.logo_url}
              primaryColor={activeTheme.primary_color}
              size={200}
            />
          </div>
        )}
        
        {/* Leaderboard */}
        {room.settings?.show_leaderboard !== false && currentActivation?.type !== 'leaderboard' && (
          <LeaderboardDisplay 
            roomId={room.id}
            maxPlayers={20}
            autoRefresh={true}
            refreshInterval={10000}
            showStats={true}
          />
        )}

        {/* Debug Panel */}
        {debugMode && (
          <div className="mt-4 p-4 bg-black/70 text-green-400 rounded-lg font-mono text-xs">
            <div className="mb-2 font-bold">Debug Info:</div>
            <div>Room ID: {room.id}</div>
            <div>Room Code: {room.room_code}</div>
            <div>Players: {Array.isArray(players) ? players.length : 'Not an array'}</div>
            <div>Current Activation: {currentActivation?.id || 'None'}</div>
            <div>Activation Type: {currentActivation?.type || 'N/A'}</div>
            <div>Poll State: {pollState}</div>
            <div>Media Type: {currentActivation?.media_type || 'None'}</div>
            <div>Media URL: {currentActivation?.media_url || 'None'}</div>
            <div>Poll Total Votes: {totalVotes}</div>
            <div>Poll Votes: {JSON.stringify(pollVotes)}</div>
            <div>Show Answers: {showAnswers ? 'true' : 'false'}</div>
            
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => window.location.reload()}
                className="px-2 py-1 bg-green-800 text-green-200 rounded"
              >
                Refresh Page
              </button>
              
              <button
                onClick={() => {
                  console.log('Current players:', players);
                  console.log('Current activation:', currentActivation);
                  console.log('Current rankings:', playerRankings);
                  console.log('Poll votes:', pollVotes);
                  console.log('Total votes:', totalVotes);
                }}
                className="px-2 py-1 bg-blue-800 text-blue-200 rounded"
              >
                Log State
              </button>
              <button
                onClick={() => setActivationRefreshCount(c => c + 1)}
                className="ml-2 px-2 py-1 bg-purple-800 text-purple-200 rounded"
              >
                Refresh Activation
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}