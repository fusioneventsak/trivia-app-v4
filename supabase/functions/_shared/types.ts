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