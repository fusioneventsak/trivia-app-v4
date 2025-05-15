import { supabase } from './supabase';

/**
 * Ensures the current user has a record in the users table
 */
export const syncUserRecord = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.log('No user to sync');
      return null;
    }
    
    // Check for existing user record
    const { data: existingUser, error: queryError } = await supabase
      .from('users')
      .select('id, last_login, role, email')
      .eq('id', user.id)
      .maybeSingle();
    
    if (queryError) {
      console.error('Error checking for existing user:', queryError);
      return user;
    }
    
    const now = new Date().toISOString();
    
    if (!existingUser && user.email) {
      console.log('Creating user record for:', user.email);
      
      // Create new user record
      const { error: insertError } = await supabase
        .from('users')
        .upsert({
          id: user.id,
          email: user.email,
          created_at: now,
          last_login: now,
          // Set role to admin if this is the admin email
          role: user.email === 'info@fusion-events.ca' ? 'admin' : 'user'
        });
        
      if (insertError && insertError.code !== '23505') {
        console.error('Error inserting user:', insertError);
      }
    } else if (existingUser) {
      // Update last_login if it's been more than 5 minutes
      const lastLogin = new Date(existingUser.last_login || now);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      if (lastLogin < fiveMinutesAgo) {
        const { error: updateError } = await supabase
          .from('users')
          .update({ last_login: now })
          .eq('id', user.id);
          
        if (updateError) {
          console.error('Error updating last_login:', updateError);
        }
      }
      
      // Return user with role and email
      return {
        ...user,
        role: existingUser.role,
        email: existingUser.email
      };
    }
    
    return user;
  } catch (error) {
    console.error('Error syncing user record:', error);
    return null;
  }
};

/**
 * Check if a user has admin privileges
 */
export const checkIsAdmin = async (): Promise<boolean> => {
  try {
    // First check if we have a valid session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      console.log('No valid session found');
      return false;
    }
    
    // Admin users are identified by email
    if (session.user.email === 'info@fusion-events.ca') {
      console.log('User is admin by email match');
      return true;
    }
    
    // Check if user has admin role in database
    const { data: userData, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', session.user.id)
      .single();
      
    if (error) {
      console.error('Error checking admin role:', error);
      return false;
    }
    
    const isAdmin = userData?.role === 'admin';
    console.log('Admin role check result:', isAdmin);
    return isAdmin;
  } catch (error) {
    console.error('Error in checkIsAdmin:', error);
    return false;
  }
};

/**
 * Check if a user has admin access (alias for checkIsAdmin)
 */
export const hasAdminAccess = checkIsAdmin;

/**
 * Handle logging in a user
 */
export const loginUser = async (email: string, password: string) => {
  try {
    // First try to sign in
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      console.error('Login error:', error);
      throw new Error('Invalid email or password');
    }
    
    // Ensure user record exists and update last login
    if (data.user) {
      const user = await syncUserRecord();
      return { user, error: null };
    }
    
    throw new Error('Failed to sync user record');
  } catch (error: any) {
    console.error('Login error:', error);
    return { 
      user: null, 
      error: error.message || 'An error occurred during login'
    };
  }
};

/**
 * Handle logging out a user
 */
export const logoutUser = async () => {
  try {
    // Clear local storage
    localStorage.clear();
    
    // Sign out through Supabase
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    
    return { error: null };
  } catch (error: any) {
    console.error('Logout error:', error);
    return { error: error.message };
  }
};

/**
 * Force a token refresh
 */
export const forceTokenRefresh = async () => {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) {
      console.error('Error refreshing token:', error);
      return false;
    }
    return !!data.session;
  } catch (error) {
    console.error('Error in forceTokenRefresh:', error);
    return false;
  }
};

interface PointDistributionOptions {
  activationId: string;
  roomId: string;
  playerId: string;
  playerName: string;
  isCorrect: boolean;
  timeTakenMs: number;
  answer: string;
}

/**
 * Distributes points to a player for answering a question
 * Handles all the logic for calculating points, updating scores, and logging events
 */
export async function distributePoints({
  activationId,
  roomId,
  playerId,
  playerName,
  isCorrect,
  timeTakenMs,
  answer
}: PointDistributionOptions): Promise<{
  success: boolean;
  pointsAwarded: number;
  newScore: number;
  error?: string;
}> {
  try {
    console.log(`Distributing points for player ${playerId} (${playerName}): correct=${isCorrect}, time=${timeTakenMs}ms`);
    
    // Convert time taken to seconds
    const timeTakenSeconds = timeTakenMs / 1000;
    
    // Calculate points based on correctness and time taken
    const pointsAwarded = isCorrect ? calculatePoints(timeTakenSeconds) : 0;

    // Log the points calculation details
    console.log(`Points calculation: isCorrect=${isCorrect}, timeTakenSeconds=${timeTakenSeconds}, pointsAwarded=${pointsAwarded}`);
    
    // If not correct or no points awarded, just log the event and return
    if (pointsAwarded <= 0 || !isCorrect) {
      // Log analytics event
      await supabase.from('analytics_events').insert([{
        event_type: 'question_answer',
        room_id: roomId,
        activation_id: activationId,
        user_id: null,
        event_data: {
          player_id: playerId,
          player_name: playerName,
          answer: answer,
          is_correct: isCorrect,
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
    
    // Get current player data including stats
    const { data: playerData, error: playerError } = await supabase
      .from('players')
      .select('score, stats')
      .eq('id', playerId)
      .single();
      
    if (playerError) {
      console.error('Error fetching player score and stats:', playerError);
      return {
        success: false,
        pointsAwarded: 0,
        newScore: 0,
        error: 'Failed to fetch player stats'
      };
    }
    
    // Calculate new score
    const currentScore = playerData.score || 0;
    const newScore = currentScore + pointsAwarded;
    
    // Get current stats or create default stats object
    let stats = playerData.stats || {
      totalPoints: 0,
      correctAnswers: 0, 
      totalAnswers: 0,
      averageResponseTimeMs: 0
    };
    
    // Calculate new stats
    const totalAnswers = stats.totalAnswers + 1;
    const correctAnswers = stats.correctAnswers + (isCorrect ? 1 : 0);
    const totalPoints = stats.totalPoints + pointsAwarded;
    
    // Calculate new average response time (weighted average)
    const prevTotalTime = stats.averageResponseTimeMs * stats.totalAnswers;
    const newTotalTime = prevTotalTime + timeTakenMs;
    const averageResponseTimeMs = totalAnswers > 0 ? newTotalTime / totalAnswers : 0;
    
    console.log(`Player ${playerName} stats update:`, {
      currentScore,
      newScore,
      totalPoints,
      correctAnswers,
      totalAnswers,
      averageResponseTimeMs
    });
    
    // Update player score and stats in database
    const { error: updateError } = await supabase
      .from('players')
      .update({ 
        score: newScore,
        stats: {
          totalPoints,
          correctAnswers,
          totalAnswers,
          averageResponseTimeMs
        }
      })
      .eq('id', playerId);
      
    if (updateError) {
      console.error('Error updating player score and stats:', updateError);
      return {
        success: false,
        pointsAwarded: 0,
        newScore: currentScore,
        error: 'Failed to update player score'
      };
    }
    
    console.log(`Player ${playerName} awarded ${pointsAwarded} points, new score: ${newScore}`);
    
    // Log analytics event
    await logAnswerEvent({
      activationId,
      roomId,
      playerId,
      playerName,
      isCorrect,
      pointsAwarded,
      timeTakenMs,
      answer,
      newScore
    });
    
    // Return success with awarded points
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
      error: 'Failed to distribute points'
    };
  }
}

/**
 * Logs an answer event to the analytics_events table
 */
async function logAnswerEvent({
  activationId,
  roomId,
  playerId,
  playerName,
  isCorrect,
  pointsAwarded,
  timeTakenMs,
  answer,
  newScore
}: PointDistributionOptions & { pointsAwarded: number, newScore?: number }): Promise<void> {
  try {
    await supabase.from('analytics_events').insert([{
      event_type: 'question_answer',
      room_id: roomId,
      activation_id: activationId,
      user_id: null,
      event_data: {
        player_id: playerId,
        player_name: playerName,
        answer: answer,
        is_correct: isCorrect,
        points_awarded: pointsAwarded,
        time_taken_ms: timeTakenMs,
        new_score: newScore,
        awarded_at: new Date().toISOString()
      }
    }]);
  } catch (error) {
    console.error('Error logging answer event:', error);
  }
}

/**
 * Checks if a player has already answered a question
 */
export async function hasPlayerAnswered(
  activationId: string,
  playerId: string
): Promise<boolean> {
  try {
    const { count, error } = await supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'question_answer')
      .eq('activation_id', activationId)
      .filter('event_data->player_id', 'eq', playerId);
      
    if (error) {
      console.error('Error checking if player answered:', error);
      return false;
    }
    
    return count > 0;
  } catch (error) {
    console.error('Error checking if player answered:', error);
    return false;
  }
}

/**
 * Checks if a player has already voted in a poll
 */
export async function hasPlayerVoted(
  activationId: string,
  playerId: string
): Promise<boolean> {
  try {
    console.log(`Checking if player ${playerId} has voted in activation ${activationId}`);
    const { count, error } = await supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'poll_vote')
      .eq('activation_id', activationId)
      .filter('event_data->player_id', 'eq', playerId);
      
    if (error) {
      console.error('Error checking if player voted:', error);
      return false;
    }
    
    console.log(`Player ${playerId} has ${count > 0 ? '' : 'not '}voted in this poll`);
    return count > 0;
  } catch (error) {
    console.error('Error checking if player voted:', error);
    return false;
  }
}

/**
 * Gets the current leaderboard for a room
 */
export async function getLeaderboard(roomId: string): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('players')
      .select('id, name, score, stats')
      .eq('room_id', roomId)
      .order('score', { ascending: false });
      
    if (error) {
      console.error('Error fetching leaderboard:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return [];
  }
}

/**
 * Gets all poll votes for an activation and returns them in a structured format
 */
export async function getPollVotes(activationId: string): Promise<{[key: string]: number}> {
  try {
    console.log(`Fetching poll votes for activation ${activationId}`);
    const { data, error } = await supabase
      .from('analytics_events')
      .select('event_data')
      .eq('event_type', 'poll_vote')
      .eq('activation_id', activationId);
      
    if (error) {
      console.error('Error fetching poll votes:', error);
      return {};
    }
    
    // Count votes by answer
    const votes: {[key: string]: number} = {};
    
    if (data && data.length > 0) {
      data.forEach(event => {
        const answer = event.event_data?.answer;
        if (answer) {
          votes[answer] = (votes[answer] || 0) + 1;
        }
      });
      
      console.log(`Fetched ${data.length} poll votes for activation ${activationId}`);
      console.log('Vote counts:', votes);
    } else {
      console.log(`No votes found for activation ${activationId}`);
    }
    
    return votes;
  } catch (error) {
    console.error('Error fetching poll votes:', error);
    return {};
  }
}

/**
 * Distributes points to all players who answered correctly when timer expires
 */
export async function distributePointsOnTimerExpiry(
  activationId: string,
  roomId: string
): Promise<{
  success: boolean;
  playersRewarded: number;
  error?: string;
}> {
  try {
    // Get activation details to determine correct answer
    const { data: activation, error: activationError } = await supabase
      .from('activations')
      .select('type, correct_answer, exact_answer')
      .eq('id', activationId)
      .single();
      
    if (activationError) {
      console.error('Error fetching activation:', activationError);
      return {
        success: false,
        playersRewarded: 0,
        error: 'Failed to fetch activation details'
      };
    }
    
    // Get all answers for this activation
    const { data: answers, error: answersError } = await supabase
      .from('analytics_events')
      .select('*')
      .eq('event_type', 'question_answer')
      .eq('activation_id', activationId)
      .eq('room_id', roomId);
      
    if (answersError) {
      console.error('Error fetching answers:', answersError);
      return {
        success: false,
        playersRewarded: 0,
        error: 'Failed to fetch answers'
      };
    }
    
    if (!answers || answers.length === 0) {
      console.log('No answers found for this activation');
      return {
        success: true,
        playersRewarded: 0
      };
    }
    
    // Process each answer
    let playersRewarded = 0;
    const processedPlayers = new Set<string>();
    const pointsAwarded = 50; // Default points for timer expiry
    
    for (const answer of answers) {
      const eventData = answer.event_data;
      
      // Skip if no player ID or already processed this player
      if (!eventData.player_id || processedPlayers.has(eventData.player_id)) {
        continue;
      }
      
      // Skip if points were already awarded
      if (eventData.points_awarded && eventData.points_awarded > 0) {
        processedPlayers.add(eventData.player_id);
        continue;
      }
      
      // Check if answer is correct
      let isCorrect = false;
      if (activation.type === 'multiple_choice' && activation.correct_answer) {
        isCorrect = eventData.answer === activation.correct_answer;
      } else if (activation.type === 'text_answer' && activation.exact_answer) {
        isCorrect = eventData.answer.toLowerCase().trim() === activation.exact_answer.toLowerCase().trim();
      }
      
      // Skip if answer is incorrect
      if (!isCorrect) {
        processedPlayers.add(eventData.player_id);
        continue;
      }
      
      // Get current player data
      const { data: playerData, error: playerError } = await supabase
        .from('players')
        .select('score, stats')
        .eq('id', eventData.player_id)
        .single();
        
      if (playerError) {
        console.error('Error fetching player score and stats:', playerError);
        continue;
      }
      
      // Update player stats
      const currentScore = playerData.score || 0;
      const newScore = currentScore + pointsAwarded;
      
      // Get current stats or create default stats object
      let stats = playerData.stats || {
        totalPoints: 0,
        correctAnswers: 0, 
        totalAnswers: 0,
        averageResponseTimeMs: 0
      };
      
      // Calculate new stats
      const totalAnswers = stats.totalAnswers + 1;
      const correctAnswers = stats.correctAnswers + 1; // This is correct since we already verified the answer is correct
      const totalPoints = stats.totalPoints + pointsAwarded;
      
      // Calculate new average response time
      const prevTotalTime = stats.averageResponseTimeMs * stats.totalAnswers;
      const newTotalTime = prevTotalTime + eventData.time_taken_ms;
      const averageResponseTimeMs = totalAnswers > 0 ? newTotalTime / totalAnswers : 0;
      
      console.log(`Player ${eventData.player_id} rewarded with ${pointsAwarded} points, new score: ${newScore}`);
      
      // Update player score
      const { error: updateError } = await supabase
        .from('players')
        .update({ 
          score: newScore,
          stats: {
            totalPoints,
            correctAnswers,
            totalAnswers,
            averageResponseTimeMs
          }
        })
        .eq('id', eventData.player_id);
        
      if (updateError) {
        console.error('Error updating player score and stats:', updateError);
        continue;
      }
      
      // Update the analytics event to mark points as awarded
      const { error: eventUpdateError } = await supabase
        .from('analytics_events')
        .update({
          event_data: {
            ...eventData,
            points_awarded: pointsAwarded,
            new_score: newScore,
            awarded_at: new Date().toISOString()
          }
        })
        .eq('id', answer.id);
        
      if (eventUpdateError) {
        console.error('Error updating analytics event:', eventUpdateError);
      } else {
        playersRewarded++;
        processedPlayers.add(eventData.player_id);
      }
    }
    
    console.log(`Rewarded ${playersRewarded} players`);
    
    return {
      success: true,
      playersRewarded
    };
  } catch (error) {
    console.error('Error distributing points on timer expiry:', error);
    return {
      success: false,
      playersRewarded: 0,
      error: 'Failed to distribute points on timer expiry'
    };
  }
}

/**
 * Gets player's previous poll vote if it exists
 */
export async function getPlayerPollVote(
  activationId: string,
  playerId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('analytics_events')
      .select('event_data')
      .eq('event_type', 'poll_vote')
      .eq('activation_id', activationId)
      .filter('event_data->player_id', 'eq', playerId)
      .maybeSingle();
      
    if (error || !data) {
      return null;
    }
    
    return data.event_data.answer || null;
  } catch (error) {
    console.error('Error getting player poll vote:', error);
    return null;
  }
}