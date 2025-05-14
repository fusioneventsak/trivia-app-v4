import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Play, PauseCircle, BarChart4, Eye, EyeOff, RefreshCw, AlertCircle, ExternalLink, Code, Lock, Check, Info, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useGameStore } from '../../store/gameStore';
import { Link } from 'react-router-dom';
import { distributePointsOnTimerExpiry } from '../../lib/point-distribution';

interface HostControlsProps {
  roomId: string;
}

export default function HostControls({ roomId }: HostControlsProps) {
  const { currentActivation, setCurrentActivation } = useGameStore();
  const [activations, setActivations] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollState, setPollState] = useState<'pending' | 'voting' | 'closed'>('pending');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [showRoomCode, setShowRoomCode] = useState<boolean>(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [isControllingPoll, setIsControllingPoll] = useState(false);
  const [isDistributingPoints, setIsDistributingPoints] = useState(false);
  
  // Subscribe to game session changes
  useEffect(() => {
    if (!roomId) return;

    // Get room code
    const fetchRoomCode = async () => {
      try {
        const { data, error: roomError } = await supabase
          .from('rooms')
          .select('room_code')
          .eq('id', roomId)
          .single();
          
        if (!roomError && data) {
          setRoomCode(data.room_code);
        }
      } catch (err) {
        console.error('Error fetching room code:', err);
      }
    };
    
    fetchRoomCode();

    // Subscribe to game session changes
    const subscription = supabase.channel('game_session_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'game_sessions',
        filter: `room_id=eq.${roomId}`
      }, async (payload) => {
        console.log('Game session change detected:', payload);
        if (payload.new?.current_activation !== payload.old?.current_activation) {
          setCurrentActivation(payload.new?.current_activation || null);
          
          // If we have a new activation, check its poll state and type
          if (payload.new?.current_activation) {
            try {
              const { data } = await supabase
                .from('activations')
                .select('poll_state, type, time_limit, timer_started_at, show_answers')
                .eq('id', payload.new.current_activation)
                .single();
                
              if (data) {
                setActiveType(data.type);
                if (data.type === 'poll') {
                  setPollState(data.poll_state || 'pending');
                }

                // If this is a text answer with a time limit but no timer_started_at
                if (data.type === 'text_answer' && data.time_limit && !data.timer_started_at) {
                  // Start the timer
                  await supabase
                    .from('activations')
                    .update({ timer_started_at: new Date().toISOString() })
                    .eq('id', payload.new.current_activation);
                }
              }
            } catch (error) {
              console.error('Error fetching activation details:', error);
            }
          } else {
            setActiveType(null);
          }
        }
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [roomId, setCurrentActivation]);
  
  // Subscribe to activation updates for poll state changes
  useEffect(() => {
    if (!roomId || !currentActivation) return;

    const activationSubscription = supabase.channel(`activation_updates_${currentActivation}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'activations',
        filter: `id=eq.${currentActivation}`
      }, (payload) => {
        if (payload.new && payload.new.poll_state !== payload.old?.poll_state) {
          setPollState(payload.new.poll_state || 'pending');
        }
      })
      .subscribe();

    // Also fetch the current activation details
    const fetchActivationDetails = async () => {
      try {
        const { data, error } = await supabase
          .from('activations')
          .select('poll_state, type, time_limit, timer_started_at')
          .eq('id', currentActivation)
          .single();
          
        if (error) throw error;
        
        if (data) {
          setActiveType(data.type);
          if (data.type === 'poll') {
            setPollState(data.poll_state || 'pending');
          }

          // If this is a text answer with a time limit but no timer_started_at
          if (data.type === 'text_answer' && data.time_limit && !data.timer_started_at) {
            // Start the timer
            await supabase
              .from('activations')
              .update({ timer_started_at: new Date().toISOString() })
              .eq('id', currentActivation);
          }
        }
      } catch (err) {
        console.error('Error fetching activation details:', err);
      }
    };
    
    fetchActivationDetails();

    return () => {
      activationSubscription.unsubscribe();
    };
  }, [roomId, currentActivation]);

  // Load activations and set current index
  useEffect(() => {
    if (roomId) {
      fetchActivations();
      fetchRoomCode();
    }
  }, [roomId]);
  
  useEffect(() => {
    // Find current activation index
    if (currentActivation && activations.length > 0) {
      const index = activations.findIndex(a => 
        a.id === currentActivation || 
        a.id === activations.find(t => t.id === currentActivation)?.parent_id
      );
      
      if (index !== -1) {
        setCurrentIndex(index);
      }
    } else {
      setCurrentIndex(-1);
    }
  }, [currentActivation, activations]);
  
  const fetchRoomCode = async () => {
    if (!roomId) return;
    
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('room_code')
        .eq('id', roomId)
        .single();
        
      if (error) throw error;
      if (data) {
        setRoomCode(data.room_code);
      }
    } catch (err) {
      console.error('Error fetching room code:', err);
    }
  };

  const fetchActivations = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('activations')
        .select('*')
        .eq('room_id', roomId)
        .eq('is_template', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setActivations(data || []);
    } catch (err: any) {
      console.error('Error fetching activations:', err);
      setError(err.message || 'Failed to load activations');
    } finally {
      setLoading(false);
    }
  };
  
  const activateNext = async () => {
    if (activations.length === 0) return;
    
    const nextIndex = currentIndex < activations.length - 1 ? currentIndex + 1 : 0;
    activateTemplate(activations[nextIndex]);
  };
  
  const activatePrevious = async () => {
    if (activations.length === 0) return;
    
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : activations.length - 1;
    activateTemplate(activations[prevIndex]);
  };
  
  const activateTemplate = async (template: any) => {
    try {
      setLoading(true);
      setError(null);
      
      // First deactivate current activation if exists
      if (currentActivation) {
        const { data: session } = await supabase
          .from('game_sessions')
          .select('*')
          .eq('room_id', roomId)
          .maybeSingle();

        if (session) {
          await supabase
            .from('game_sessions')
            .update({ current_activation: null })
            .eq('id', session.id);
        }
        
        setCurrentActivation(null);
      }
      
      // Prepare activation data
      const activationData: any = {
        type: template.type,
        question: template.question || template.title,
        options: template.options,
        correct_answer: template.correct_answer,
        exact_answer: template.exact_answer,
        media_type: template.media_type,
        media_url: template.media_url,
        parent_id: template.id,
        is_template: false,
        room_id: roomId,
        poll_state: 'pending',
        poll_display_type: template.poll_display_type,
        poll_result_format: template.poll_result_format,
        option_colors: template.option_colors,
        title: template.title || template.question,
        description: template.description || '',
        theme: template.theme,
        logo_url: template.logo_url,
        max_players: template.max_players,
        time_limit: template.time_limit,
        show_answers: template.show_answers
      };
      
      // If timer is enabled, set timer_started_at for multiple choice and text answer
      if (template.time_limit && template.time_limit > 0 && 
          (template.type === 'multiple_choice' || template.type === 'text_answer')) {
        activationData.timer_started_at = new Date().toISOString();
      }
      
      // Create the activation
      const { data, error } = await supabase
        .from('activations')
        .insert([activationData])
        .select()
        .single();
      
      if (error) throw error;
      
      if (data) {
        // Update the game session with the new activation
        const { error: sessionError } = await supabase
          .from('game_sessions')
          .update({ 
            current_activation: data.id,
            is_live: true 
          })
          .eq('room_id', roomId);
          
        if (sessionError) throw sessionError;
        
        setCurrentActivation(data.id);
        setActiveType(data.type);
        setPollState('pending');
        
        // Show success message
        setSuccessMessage('Template activated!');
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (error) {
      console.error('Error activating template:', error);
      setError('Failed to activate template');
    } finally {
      setLoading(false);
    }
  };
  
  const clearCurrentActivation = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Get current game session
      const { data: session } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('room_id', roomId)
        .maybeSingle();
      
      if (session) {
        // Update game session to clear current activation
        const { error: sessionError } = await supabase
          .from('game_sessions')
          .update({ current_activation: null })
          .eq('id', session.id);
      
        if (sessionError) throw sessionError;
      }
      
      setCurrentActivation(null);
      setActiveType(null);
      
      // Show success message
      setSuccessMessage('Template deactivated');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error: any) {
      console.error('Error clearing activation:', error);
      setError('Failed to clear activation');
    } finally {
      setLoading(false);
    }
  };
  
  const startPollVoting = async () => {
    if (!currentActivation) return;
    
    try {
      setIsControllingPoll(true);
      setError(null);
      
      // Update the poll state to voting
      const { error } = await supabase
        .from('activations')
        .update({ poll_state: 'voting' })
        .eq('id', currentActivation);
        
      if (error) throw error;
      
      setPollState('voting');
      
      // Also broadcast the state change through the poll channel
      const channel = supabase.channel(`poll-${currentActivation}`);
      await channel.subscribe();
      
      channel.send({
        type: 'broadcast',
        event: 'poll-state-change',
        payload: { state: 'voting' }
      });
      
      // Show success message
      setSuccessMessage('Voting started!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error: any) {
      console.error('Error starting poll voting:', error);
      setError('Failed to start voting');
    } finally {
      setIsControllingPoll(false);
    }
  };
  
  const lockPollVoting = async () => {
    if (!currentActivation) return;
    
    try {
      setIsControllingPoll(true);
      setError(null);
      
      // Update the poll state to closed
      const { error } = await supabase
        .from('activations')
        .update({ poll_state: 'closed' })
        .eq('id', currentActivation);
        
      if (error) throw error;
      
      setPollState('closed');
      
      // Also broadcast the state change through the poll channel
      const channel = supabase.channel(`poll-${currentActivation}`);
      await channel.subscribe();
      
      channel.send({
        type: 'broadcast',
        event: 'poll-state-change',
        payload: { state: 'closed' }
      });
      
      // Show success message
      setSuccessMessage('Voting locked!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error: any) {
      console.error('Error closing poll voting:', error);
      setError('Failed to close voting');
    } finally {
      setIsControllingPoll(false);
    }
  };

  const toggleRoomCode = () => {
    setShowRoomCode(!showRoomCode);
  };
  
  // Start or control timer for text answer questions
  const manageTextAnswerTimer = async () => {
    if (!currentActivation) return;
    
    try {
      setLoading(true);
      
      // Fetch current activation details
      const { data: activation, error: fetchError } = await supabase
        .from('activations')
        .select('timer_started_at, time_limit, show_answers')
        .eq('id', currentActivation)
        .single();
      
      if (fetchError) throw fetchError;
      
      if (!activation) {
        throw new Error('Activation not found');
      }
      
      // If timer isn't started yet, start it
      if (!activation.timer_started_at && activation.time_limit) {
        // Start the timer
        const { error: updateError } = await supabase
          .from('activations')
          .update({ timer_started_at: new Date().toISOString() })
          .eq('id', currentActivation);
          
        if (updateError) throw updateError;
        
        setSuccessMessage('Timer started!');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else if (activation.timer_started_at) {
        // Timer is already running - reveal answers immediately
        const { error: updateError } = await supabase
          .from('activations')
          .update({ show_answers: true })
          .eq('id', currentActivation);
          
        if (updateError) throw updateError;
        
        // Distribute points to all players who answered correctly
        if (activeType === 'multiple_choice' || activeType === 'text_answer') {
          setIsDistributingPoints(true);
          
          try {
            const result = await distributePointsOnTimerExpiry(currentActivation, roomId);
            
            if (result.success && result.playersRewarded > 0) {
              setSuccessMessage(`Answers revealed! ${result.playersRewarded} player(s) received points.`);
            } else {
              setSuccessMessage('Answers revealed!');
            }
          } catch (err) {
            console.error('Error distributing points:', err);
            setSuccessMessage('Answers revealed! (Error distributing points)');
          } finally {
            setIsDistributingPoints(false);
          }
        } else {
          setSuccessMessage('Answers revealed!');
        }
        
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        // No timer set up for this activation
        setError('This activation does not have a timer configured');
      }
    } catch (error: any) {
      console.error('Error managing timer:', error);
      setError(error.message || 'Failed to manage timer');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="bg-gray-100 rounded-lg p-4 border border-gray-200">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-800">Host Controls</h3>
            {loading && <RefreshCw className="w-4 h-4 animate-spin text-gray-500" />}
            
            {roomCode && showRoomCode && (
              <Link 
                to={`/results/${roomCode}`} 
                target="_blank"
                className="ml-3 px-3 py-1 bg-green-100 text-green-700 text-sm rounded-full flex items-center hover:bg-green-200 transition"
              >
                View Results <ExternalLink className="w-3 h-3 ml-1" />
              </Link>
            )}
          </div>
        </div>
        
        {error && (
          <div className="p-2 bg-red-100 text-red-700 rounded-md flex items-center">
            <AlertCircle className="w-4 h-4 mr-1 flex-shrink-0" /> 
            <span className="text-sm">{error}</span>
          </div>
        )}
        
        {successMessage && (
          <div className="p-2 bg-green-100 text-green-700 rounded-md flex items-center">
            <Check className="w-4 h-4 mr-1 flex-shrink-0" /> 
            <span className="text-sm">{successMessage}</span>
          </div>
        )}

        {/* PROMINENTLY DISPLAYED MULTIPLE CHOICE TIMER CONTROLS */}
        {activeType === 'multiple_choice' && currentActivation && (
          <div className="p-4 bg-indigo-600 text-white rounded-lg shadow-md">
            <h2 className="font-bold text-lg mb-3 flex items-center">
              <Clock className="w-5 h-5 mr-2" />
              Multiple Choice Timer Controls
            </h2>
            
            <div className="flex flex-wrap gap-3 items-center">
              <button
                onClick={manageTextAnswerTimer}
                disabled={loading || isDistributingPoints}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition font-medium disabled:opacity-50"
              >
                {loading || isDistributingPoints ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <Play className="w-5 h-5" />
                )}
                Start Timer / Reveal Answers
              </button>
              
              <div className="text-white font-semibold ml-auto">
                <span className="bg-white/20 px-3 py-1 rounded-full ml-2">
                  Multiple Choice Question Active
                </span>
              </div>
            </div>
            
            <div className="mt-3 p-3 bg-white/20 rounded-lg text-sm">
              <div className="flex items-center gap-2 mb-1">
                <Info className="w-4 h-4" />
                <span className="font-semibold">How to use timer controls:</span>
              </div>
              <ol className="list-decimal ml-5 space-y-1">
                <li><strong>Start Timer</strong> - Begin countdown for question</li>
                <li><strong>Reveal Answers</strong> - Immediately show correct answer (skip timer)</li>
                <li>The timer will automatically reveal the correct answer when it expires</li>
              </ol>
            </div>
          </div>
        )}

        {/* PROMINENTLY DISPLAYED TEXT ANSWER TIMER CONTROLS */}
        {activeType === 'text_answer' && currentActivation && (
          <div className="p-4 bg-blue-600 text-white rounded-lg shadow-md">
            <h2 className="font-bold text-lg mb-3 flex items-center">
              <Clock className="w-5 h-5 mr-2" />
              Text Answer Timer Controls
            </h2>
            
            <div className="flex flex-wrap gap-3 items-center">
              <button
                onClick={manageTextAnswerTimer}
                disabled={loading || isDistributingPoints}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition font-medium disabled:opacity-50"
              >
                {loading || isDistributingPoints ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <Play className="w-5 h-5" />
                )}
                Start Timer / Reveal Answers
              </button>
              
              <div className="text-white font-semibold ml-auto">
                <span className="bg-white/20 px-3 py-1 rounded-full ml-2">
                  Text Answer Question Active
                </span>
              </div>
            </div>
            
            <div className="mt-3 p-3 bg-white/20 rounded-lg text-sm">
              <div className="flex items-center gap-2 mb-1">
                <Info className="w-4 h-4" />
                <span className="font-semibold">How to use timer controls:</span>
              </div>
              <ol className="list-decimal ml-5 space-y-1">
                <li><strong>Start Timer</strong> - Begin countdown for text answer</li>
                <li><strong>Reveal Answers</strong> - Immediately show answers (skip timer)</li>
                <li>The timer will automatically show answers when it expires</li>
              </ol>
            </div>
          </div>
        )}

        {/* PROMINENTLY DISPLAYED POLL CONTROLS */}
        {activeType === 'poll' && currentActivation && (
          <div className="p-4 bg-purple-600 text-white rounded-lg shadow-md">
            <h2 className="font-bold text-lg mb-3 flex items-center">
              <BarChart4 className="w-5 h-5 mr-2" />
              Poll Voting Controls
            </h2>
            
            <div className="flex flex-wrap gap-3 items-center">
              {pollState === 'pending' && (
                <button
                  onClick={startPollVoting}
                  disabled={isControllingPoll || loading}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition font-medium disabled:opacity-50"
                >
                  {isControllingPoll ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Play className="w-5 h-5" />
                  )}
                  <span>{isControllingPoll ? 'Starting...' : 'Start Voting'}</span>
                </button>
              )}
              
              {pollState === 'voting' && (
                <button
                  onClick={lockPollVoting}
                  disabled={isControllingPoll || loading}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600 transition font-medium disabled:opacity-50"
                >
                  {isControllingPoll ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Lock className="w-5 h-5" />
                  )}
                  <span>{isControllingPoll ? 'Locking...' : 'Lock Voting'}</span>
                </button>
              )}
              
              {pollState === 'closed' && (
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md shadow-sm font-medium">
                  <Lock className="w-5 h-5" />
                  <span>Voting Locked</span>
                </div>
              )}
              
              <div className="text-white font-semibold ml-auto">
                Status: <span className="bg-white/20 px-3 py-1 rounded-full ml-2">
                  {pollState === 'pending' ? 'Ready to Start' : 
                   pollState === 'voting' ? 'Voting Open' : 
                   'Voting Closed'}
                </span>
              </div>
            </div>
            
            <div className="mt-3 p-3 bg-white/20 rounded-lg text-sm">
              <div className="flex items-center gap-2 mb-1">
                <Info className="w-4 h-4" />
                <span className="font-semibold">How to use poll controls:</span>
              </div>
              <ol className="list-decimal ml-5 space-y-1">
                <li><strong>Start Voting</strong> - Open the poll for responses</li>
                <li><strong>Lock Voting</strong> - Close the poll to prevent new responses</li>
                <li>Results will update in real-time as votes come in</li>
              </ol>
            </div>
            
            {/* Timer Controls for Polls */}
            {currentActivation && (
              <div className="mt-3 p-3 bg-white/20 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4" />
                  <span className="font-semibold">Poll Timer:</span>
                </div>
                
                <button
                  onClick={manageTextAnswerTimer}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition font-medium disabled:opacity-50"
                >
                  <Play className="w-5 h-5" />
                  {!currentActivation.timer_started_at ? 'Start Timer' : 'Show Results Now'}
                </button>
                
                <p className="mt-2 text-sm">
                  Use the timer to automatically show poll results after a set time.
                </p>
              </div>
            )}
          </div>
        )}
        
        {/* Room Management */}
        <div className="p-4 bg-blue-600 text-white rounded-lg shadow-md">
          <h2 className="font-bold text-lg mb-3 flex items-center">
            <RefreshCw className="w-5 h-5 mr-2" />
            Room Management
          </h2>
          
          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={toggleRoomCode}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition font-medium"
            >
              <Code className="w-5 h-5" />
              <span>{showRoomCode ? 'Hide Code' : 'Show Code'}</span>
            </button>
          </div>
          
          <div className="mt-3 p-3 bg-white/20 rounded-lg text-sm">
            <p><strong>Room Code:</strong> {showRoomCode ? roomCode : '****'}</p>
            <p className="mt-1">Share this code with participants to join the room.</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {/* Navigation Controls */}
          <div className="flex items-center">
            <button
              onClick={activatePrevious}
              disabled={loading || activations.length === 0}
              className="p-2 bg-white rounded-l-md border border-r-0 border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              title="Previous activation"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            <div className="px-4 py-2 bg-white border-t border-b border-gray-300 flex items-center">
              {currentActivation ? (
                <span className="text-sm font-medium">
                  {currentIndex + 1} / {activations.length}
                </span>
              ) : (
                <span className="text-sm text-gray-500">No active question</span>
              )}
            </div>
            
            <button
              onClick={activateNext}
              disabled={loading || activations.length === 0}
              className="p-2 bg-white rounded-r-md border border-l-0 border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              title="Next activation"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          
          {/* Clear/Hide Button */}
          <button
            onClick={clearCurrentActivation}
            disabled={!currentActivation || loading}
            className="flex items-center gap-1 px-3 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"
          >
            {currentActivation ? (
              <>
                <EyeOff className="w-4 h-4" />
                <span>Hide</span>
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" />
                <span>Show</span>
              </>
            )}
          </button>
        </div>
        
        {/* Current Activation Info */}
        {currentActivation && (
          <div className="p-2 bg-gray-200 rounded-md">
            <div className="text-sm text-gray-700">
              <span className="font-medium">Current:</span> {activeType === 'multiple_choice' ? 'Multiple Choice' : 
                activeType === 'poll' ? 'Poll' : 
                activeType === 'leaderboard' ? 'Leaderboard' : 'Text Question'}
              
              {activeType === 'poll' && (
                <span className="ml-2">
                  (Status: <span className={`font-medium ${
                    pollState === 'pending' ? 'text-yellow-600' : 
                    pollState === 'voting' ? 'text-green-600' : 
                    'text-red-600'
                  }`}>
                    {pollState === 'pending' ? 'Waiting' : 
                     pollState === 'voting' ? 'Voting Open' : 
                     'Locked'}
                  </span>)
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}