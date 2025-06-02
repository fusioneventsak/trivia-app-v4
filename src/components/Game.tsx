import { useState, useRef } from 'react';
import { PlayCircle, WifiOff } from 'lucide-react';
import CountdownTimer from './ui/CountdownTimer';
import PollDisplay from './ui/PollDisplay';
import PointAnimation from './ui/PointAnimation';
import PointsDisplay from './ui/PointsDisplay';
import LeaderboardItem from './ui/LeaderboardItem';
import { getStorageUrl } from '../lib/utils';

export function Game({
  activeQuestion,
  timeRemaining,
  networkError,
  hasAnswered,
  selectedAnswer,
  textAnswer,
  setTextAnswer,
  handleMultipleChoiceAnswer,
  handleTextAnswerSubmit,
  handlePollVote,
  pollVotes,
  totalVotes,
  pollState,
  pollVoted,
  pollVoteCheckComplete,
  pointsEarned,
  getCurrentPlayer,
  playerRankings,
  previousRankings,
  currentPlayerId,
  otherPlayers,
  showLeaderboard,
  renderAnswerResult
}) {
  const leaderboardRef = useRef(null);

  const getColorForIndex = (index: number, theme?: any) => {
    if (theme?.colors?.length) {
      return theme.colors[index % theme.colors.length];
    }
    
    // Fallback colors if no theme provided
    const baseColors = [
      '#3B82F6', // Blue
      '#8B5CF6', // Purple
      '#10B981', // Green
      '#F59E0B', // Yellow
      '#EF4444', // Red
      '#06B6D4', // Cyan
      '#8B5CF6', // Purple
      '#EC4899', // Pink
      '#F97316', // Orange
      '#14B8A6', // Teal
    ];
    return baseColors[index % baseColors.length];
  };

  if (!activeQuestion) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
        <h2 className="text-2xl font-bold mb-4">Waiting for next question...</h2>
        <PlayCircle className="w-12 h-12 animate-pulse" />
      </div>
    );
  }

  if (networkError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
        <WifiOff className="w-12 h-12 mb-4 text-red-500" />
        <h2 className="text-2xl font-bold mb-2">Connection Lost</h2>
        <p className="text-gray-600">Please check your internet connection</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Game UI components */}
      <div className="max-w-3xl mx-auto">
        {/* Question display */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-4">
          {/* Timer */}
          {timeRemaining !== null && (
            <CountdownTimer 
              timeRemaining={timeRemaining} 
              totalTime={activeQuestion.time_limit || 0}
            />
          )}
          
          {/* Question text */}
          <h2 className="text-xl font-bold mb-4">{activeQuestion.question}</h2>
          
          {/* Media content */}
          {activeQuestion.media_type !== 'none' && activeQuestion.media_url && (
            <div className="mb-4">
              {activeQuestion.media_type === 'image' && (
                <img 
                  src={getStorageUrl(activeQuestion.media_url)} 
                  alt="Question media"
                  className="max-w-full rounded-lg"
                />
              )}
              {/* Add other media types here */}
            </div>
          )}
          
          {/* Answer options */}
          {activeQuestion.type === 'multiple_choice' && activeQuestion.options && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeQuestion.options.map((option, index) => (
                <button
                  key={option.text}
                  onClick={() => handleMultipleChoiceAnswer(option.text)}
                  disabled={hasAnswered}
                  className={`
                    p-4 rounded-lg text-left transition-all duration-200
                    ${hasAnswered ? 'cursor-not-allowed' : 'hover:transform hover:scale-102'}
                    ${selectedAnswer === option.text ? 'ring-2 ring-blue-500' : ''}
                    ${option.color || getColorForIndex(index, activeQuestion.theme)}
                  `}
                >
                  {option.text}
                </button>
              ))}
            </div>
          )}
          
          {/* Text answer input */}
          {activeQuestion.type === 'text_answer' && (
            <form onSubmit={handleTextAnswerSubmit} className="space-y-4">
              <input
                type="text"
                value={textAnswer}
                onChange={(e) => setTextAnswer(e.target.value)}
                disabled={hasAnswered}
                placeholder="Type your answer..."
                className="w-full p-2 border rounded"
              />
              <button
                type="submit"
                disabled={hasAnswered || !textAnswer.trim()}
                className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Submit Answer
              </button>
            </form>
          )}
          
          {/* Poll display */}
          {activeQuestion.type === 'poll' && pollVoteCheckComplete && (
            <PollDisplay
              options={activeQuestion.options || []}
              votes={pollVotes}
              totalVotes={totalVotes}
              selectedAnswer={selectedAnswer}
              onVote={handlePollVote}
              pollState={pollState}
              displayType={activeQuestion.poll_display_type || 'bar'}
              resultFormat={activeQuestion.poll_result_format || 'percentage'}
              theme={activeQuestion.theme}
              hasVoted={pollVoted}
            />
          )}
          
          {/* Answer result */}
          {renderAnswerResult()}
          
          {/* Points animation */}
          {pointsEarned > 0 && (
            <PointAnimation points={pointsEarned} />
          )}
        </div>
        
        {/* Points display */}
        <PointsDisplay 
          points={getCurrentPlayer()?.score || 0}
          rank={playerRankings[currentPlayerId || ''] || 0}
          previousRank={previousRankings[currentPlayerId || ''] || 0}
        />
        
        {/* Leaderboard */}
        <div ref={leaderboardRef}>
          {showLeaderboard && (
            <div className="bg-white rounded-lg shadow-lg p-4 mt-4">
              <h3 className="text-lg font-bold mb-4">Leaderboard</h3>
              <div className="space-y-2">
                {[getCurrentPlayer(), ...otherPlayers]
                  .sort((a, b) => (b?.score || 0) - (a?.score || 0))
                  .map((player, index) => (
                    player && <LeaderboardItem 
                      key={player.id}
                      player={player}
                      rank={index + 1}
                      isCurrentPlayer={player.id === currentPlayerId}
                    />
                  ))
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Game