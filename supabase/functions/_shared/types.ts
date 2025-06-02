export interface AnswerRequest {
  activationId: string;
  roomId: string;
  playerId: string;
  playerName: string;
  answer: string;
  timeTakenMs: number;
}

export interface AnswerResponse {
  success: boolean;
  isCorrect: boolean;
  pointsAwarded: number;
  newScore: number;
  error?: string;
  stats?: {
    totalPoints: number;
    correctAnswers: number;
    totalAnswers: number;
    averageResponseTimeMs: number;
  };
}

export interface PointCalculationConfig {
  MAX_POINTS: number;
  TIME_DEDUCTION_PER_SECOND: number;
  MIN_POINTS: number;
  INCORRECT_POINTS: number;
}

export interface RateLimitConfig {
  maxAnswersPerMinute: number;
  maxVotesPerPoll: number;
}

// Point calculation request/response types
export interface PointCalculationRequest {
  activationId: string;
  playerId: string;
  isCorrect: boolean;
  timeTakenMs: number;
  answer?: string;
  playerName?: string;
  roomId?: string;
}

export interface PointCalculationResponse {
  success: boolean;
  pointsAwarded: number;
  newScore: number;
  error?: string;
  stats?: {
    totalPoints: number;
    correctAnswers: number;
    totalAnswers: number;
    averageResponseTimeMs: number;
  };
}

// Answer validation request/response types
export interface AnswerValidationRequest {
  activationId: string;
  answer: string;
  playerId?: string;
}

export interface AnswerValidationResponse {
  isCorrect: boolean;
  activationType: 'multiple_choice' | 'text_answer' | 'poll' | 'social_wall' | 'leaderboard';
  correctAnswer?: string;
  error?: string;
}

// Player stats type
export interface PlayerStats {
  totalPoints: number;
  correctAnswers: number;
  totalAnswers: number;
  averageResponseTimeMs: number;
}

// Poll vote types
export interface PollVoteRequest {
  activationId: string;
  playerId: string;
  answer: string;
  playerName?: string;
}

export interface PollVoteResponse {
  success: boolean;
  error?: string;
}

// Activation types
export type ActivationType = 'multiple_choice' | 'text_answer' | 'poll' | 'social_wall' | 'leaderboard';
export type PollState = 'pending' | 'voting' | 'closed';
export type MediaType = 'none' | 'image' | 'youtube' | 'gif';