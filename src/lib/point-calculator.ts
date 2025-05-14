/**
 * Point calculation utility for the trivia game
 * Calculates points based on answer speed and accuracy
 */

// Constants for point calculation
export const POINT_CONFIG = {
  MAX_POINTS: 100.0,
  TIME_DEDUCTION_PER_SECOND: 2.0,
  MIN_POINTS: 10.0,
  INCORRECT_POINTS: 0.0
};

/**
 * Calculate points for a correct answer based on time taken
 * @param timeTakenSeconds Time taken to answer in seconds
 * @returns Points earned (between MIN_POINTS and MAX_POINTS)
 */
export function calculatePoints(timeTakenSeconds: number): number {
  if (timeTakenSeconds < 0) {
    timeTakenSeconds = 0;
  }
  
  // Calculate points with time deduction
  let points = POINT_CONFIG.MAX_POINTS - (timeTakenSeconds * POINT_CONFIG.TIME_DEDUCTION_PER_SECOND);
  
  // Ensure points don't go below minimum
  points = Math.max(POINT_CONFIG.MIN_POINTS, points);
  
  // Round to nearest integer for cleaner display
  return Math.round(points);
}

/**
 * Format points to 1 decimal place
 * @param points Points to format
 * @returns Formatted points string
 */
export function formatPoints(points: number): string {
  if (points === undefined || points === null) {
    return "0.0";
  }
  return Number(points).toFixed(1);
}