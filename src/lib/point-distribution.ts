import { supabase } from './supabase';

interface DistributePointsParams {
  activationId: string;
  roomId: string;
  playerId: string;
  playerName: string;
  isCorrect: boolean;
  timeTakenMs: number;
  answer: string;
}

interface DistributePointsResult {
  success: boolean;
  pointsAwarded: number;
  newScore: number;
  error?: string;
}

// Point calculation based on time
export const calculatePointsForTime = (timeTakenMs: number): number => {
  const timeTakenSeconds = timeTakenMs / 1000;
  
  if (timeTakenSeconds <= 2) return 100;
  if (timeTakenSeconds <= 5) return 90;
  if (timeTakenSeconds <= 10) return 80;
  if (timeTakenSeconds <= 15) return 70;
  if (timeTakenSeconds <= 20) return 60;
  if (timeTakenSeconds <= 30) return 50;
  return 40; // Minimum points for correct answer
};

export const distributePoints = async (params: DistributePointsParams): Promise<DistributePointsResult> => {
  const { activationId, roomId, playerId, playerName, isCorrect, timeTakenMs, answer } = params;
  
  try {
    // If not correct, no points awarded
    if (!isCorrect) {
      // Still log the attempt
      await supabase.from('analytics_events').insert([{
        event_type: 'question_answer',
        room_id: roomId,
        activation_id: activationId,
        player_name: playerName,
        event_data: {
          player_id: playerId,
          answer: answer,
          is_correct: false,
          points_awarded: 0,
          time_taken_ms: timeTakenMs
        }
      }]);
      
      return {
        success: true,
        pointsAwarded: 0,
        newScore: 0
      };
    }
    
    // Calculate points based on time
    const pointsAwarded = calculatePointsForTime(timeTakenMs);
    
    // Get current player score
    const { data: currentPlayer, error: fetchError } = await supabase
      .from('players')
      .select('score, stats')
      .eq('id', playerId)
      .single();
      
    if (fetchError) throw fetchError;
    
    const currentScore = currentPlayer?.score || 0;
    const newScore = currentScore + pointsAwarded;
    
    // Update player stats
    const currentStats = currentPlayer?.stats || {
      totalPoints: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      averageResponseTimeMs: 0
    };
    
    const newStats = {
      totalPoints: currentStats.totalPoints + pointsAwarded,
      correctAnswers: currentStats.correctAnswers + 1,
      totalAnswers: currentStats.totalAnswers + 1,
      averageResponseTimeMs: currentStats.totalAnswers === 0 
        ? timeTakenMs 
        : Math.round((currentStats.averageResponseTimeMs * currentStats.totalAnswers + timeTakenMs) / (currentStats.totalAnswers + 1))
    };
    
    // Update player score and stats
    const { error: updateError } = await supabase
      .from('players')
      .update({ 
        score: newScore,
        stats: newStats
      })
      .eq('id', playerId);
      
    if (updateError) throw updateError;
    
    // Log analytics event
    await supabase.from('analytics_events').insert([{
      event_type: 'points_awarded',
      room_id: roomId,
      activation_id: activationId,
      player_name: playerName,
      event_data: {
        player_id: playerId,
        answer: answer,
        is_correct: true,
        points_awarded: pointsAwarded,
        time_taken_ms: timeTakenMs,
        new_score: newScore
      }
    }]);
    
    return {
      success: true,
      pointsAwarded,
      newScore
    };
    
  } catch (error) {
    console.error('Error distributing points:', error);
    return {
      success: false,
      pointsAwarded: 0,
      newScore: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

// Check if player has already answered a question
export const hasPlayerAnswered = async (activationId: string, playerId: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('analytics_events')
      .select('id')
      .eq('activation_id', activationId)
      .eq('event_type', 'question_answer')
      .eq('event_data->>player_id', playerId)
      .limit(1);
      
    if (error) {
      console.error('Error checking if player answered:', error);
      return false;
    }
    
    return data && data.length > 0;
  } catch (error) {
    console.error('Error in hasPlayerAnswered:', error);
    return false;
  }
};

// Check if player has already voted in a poll using the poll_votes table
export const hasPlayerVoted = async (activationId: string, playerId: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('poll_votes')
      .select('id')
      .eq('activation_id', activationId)
      .eq('player_id', playerId)
      .maybeSingle();
      
    if (error && error.code !== 'PGRST116') {
      console.error('Error checking if player voted:', error);
      return false;
    }
    
    return !!data;
  } catch (error) {
    console.error('Error in hasPlayerVoted:', error);
    return false;
  }
};

// Get player's poll vote
export const getPlayerPollVote = async (activationId: string, playerId: string): Promise<string | null> => {
  try {
    const { data, error } = await supabase
      .from('poll_votes')
      .select('answer')
      .eq('activation_id', activationId)
      .eq('player_id', playerId)
      .maybeSingle();
      
    if (error && error.code !== 'PGRST116') {
      console.error('Error getting player poll vote:', error);
      return null;
    }
    
    return data?.answer || null;
  } catch (error) {
    console.error('Error in getPlayerPollVote:', error);
    return null;
  }
};

// Get all poll votes for an activation
export const getPollVotes = async (activationId: string): Promise<{[key: string]: number}> => {
  try {
    const { data, error } = await supabase
      .from('poll_votes')
      .select('answer')
      .eq('activation_id', activationId);
      
    if (error) {
      console.error('Error getting poll votes:', error);
      return {};
    }
    
    // Count votes by answer
    const voteCounts: {[key: string]: number} = {};
    if (data) {
      data.forEach(vote => {
        voteCounts[vote.answer] = (voteCounts[vote.answer] || 0) + 1;
      });
    }
    
    return voteCounts;
  } catch (error) {
    console.error('Error in getPollVotes:', error);
    return {};
  }
};

// Record a poll vote
export const recordPollVote = async (activationId: string, playerId: string, answer: string): Promise<boolean> => {
  try {
    // First check if player already voted
    const hasVoted = await hasPlayerVoted(activationId, playerId);
    if (hasVoted) {
      console.log('Player has already voted in this poll');
      return false;
    }
    
    // Record the vote in poll_votes table
    const { error } = await supabase
      .from('poll_votes')
      .insert([{
        activation_id: activationId,
        player_id: playerId,
        answer: answer
      }]);
      
    if (error) {
      console.error('Error recording poll vote:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error in recordPollVote:', error);
    return false;
  }
};