import React from 'react';
import { cn } from '../../lib/utils';
import { CheckCircle } from 'lucide-react';

interface PollOption {
  text: string;
  media_type?: 'none' | 'image' | 'gif';
  media_url?: string;
}

interface PollVotes {
  [key: string]: number;
}

interface PollDisplayProps {
  options: PollOption[];
  votes: PollVotes;
  totalVotes: number;
  displayType?: 'bar' | 'pie' | 'horizontal' | 'vertical';
  resultFormat?: 'percentage' | 'votes' | 'both';
  selectedAnswer?: string | null;
  themeColors?: {
    primary_color?: string;
    secondary_color?: string;
  };
  compact?: boolean;
  className?: string;
}

const PollDisplay: React.FC<PollDisplayProps> = ({
  options,
  votes,
  totalVotes,
  displayType = 'bar',
  resultFormat = 'both',
  selectedAnswer,
  themeColors = {},
  compact = false,
  className = ''
}) => {
  // Helper to get display label based on format
  const getDisplayLabel = (votes: number, percentage: string): string => {
    if (resultFormat === 'percentage') return `${percentage}%`;
    if (resultFormat === 'votes') return `${votes}`;
    return `${votes} (${percentage}%)`;
  };

  // Helper to get color for each option
  const getColorForIndex = (index: number) => {
    // Use theme colors if available
    const baseColors = [
      themeColors.primary_color || '#3B82F6',
      themeColors.secondary_color || '#8B5CF6',
      '#10B981', // Green
      '#F59E0B', // Yellow
      '#EF4444', // Red
      '#06B6D4', // Cyan
      '#EC4899', // Pink
      '#F97316', // Orange
      '#14B8A6', // Teal
    ];
    return baseColors[index % baseColors.length];
  };

  // Render pie chart
  if (displayType === 'pie') {
    return (
      <div className={cn("mt-4 p-4 bg-white/10 rounded-lg", className)}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white">Poll Results</h3>
          <div className="text-sm text-white/80">{totalVotes} votes</div>
        </div>
      
        <div className="relative w-64 h-64 mx-auto">
          {/* Simple pie chart representation */}
          <div className="w-full h-full rounded-full overflow-hidden bg-white/20 flex">
            {options.map((option, index) => {
              const voteCount = votes[option.text] || 0;
              const percentage = totalVotes > 0 ? (voteCount / totalVotes * 100) : 0;
              return percentage > 0 ? (
                <div 
                  key={index}
                  className="h-full"
                  style={{ 
                    width: `${percentage}%`,
                    backgroundColor: getColorForIndex(index)
                  }}
                />
              ) : null;
            })}
          </div>
          
          <div className="mt-4 space-y-2">
            {options.map((option, index) => {
              const voteCount = votes[option.text] || 0;
              const percentage = totalVotes > 0 ? (voteCount / totalVotes * 100).toFixed(1) : '0.0';
              
              return (
                <div key={index} className="flex items-center gap-2">
                  <div 
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: getColorForIndex(index) }}
                  />
                  <div className="flex items-center gap-2 flex-1 text-white">
                    {option.media_type !== 'none' && option.media_url && (
                      <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 bg-black/20">
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
                    <span>{option.text}</span>
                  </div>
                  <div className="text-sm text-white/80">{getDisplayLabel(voteCount, percentage)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Render vertical bars
  if (displayType === 'vertical') {
    return (
      <div className={cn("mt-4 p-4 bg-white/10 rounded-lg", className)}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white">Poll Results</h3>
          <div className="text-sm text-white/80">{totalVotes} votes</div>
        </div>
        
        {/* Vertical bars layout */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 h-48">
          {options.map((option, index) => {
            const voteCount = votes[option.text] || 0;
            const percentage = totalVotes > 0 ? (voteCount / totalVotes * 100) : 0;
            const color = getColorForIndex(index);
            const isSelected = option.text === selectedAnswer;
            
            return (
              <div key={index} className="flex flex-col items-center h-full">
                {/* Vote count at top */}
                <div className="text-sm text-white mb-1">
                  {getDisplayLabel(voteCount, percentage.toFixed(1))}
                </div>
                
                {/* Bar wrapper */}
                <div className="w-full flex-grow bg-white/20 rounded-t-lg relative flex justify-center">
                  {/* The vertical bar */}
                  <div 
                    className="absolute bottom-0 w-full transition-all duration-500 ease-out"
                    style={{ 
                      height: `${Math.max(percentage, 2)}%`,
                      backgroundColor: color,
                      border: isSelected ? '2px solid white' : 'none'
                    }}
                  >
                    {percentage > 20 && (
                      <div className="absolute top-1 inset-x-0 text-center">
                        <span className="text-xs text-white font-medium">
                          {percentage.toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Option label */}
                <div className="text-xs text-white mt-2 truncate max-w-full px-1">
                  {option.media_type !== 'none' && option.media_url && (
                    <div className="inline-block w-4 h-4 rounded-full overflow-hidden bg-black/20 mr-1 align-text-bottom">
                      <img
                        src={option.media_url}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.src = 'https://via.placeholder.com/100?text=!';
                        }}
                      />
                    </div>
                  )}
                  <span className="truncate" title={option.text}>{option.text}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Default: Horizontal bars
  return (
    <div className={cn("mt-4 p-4 bg-white/10 rounded-lg", className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-white">Poll Results</h3>
        <div className="text-sm text-white/80">{totalVotes} votes</div>
      </div>
      
      <div className="space-y-4">
        {options.map((option, index) => {
          const voteCount = votes[option.text] || 0;
          const percentage = totalVotes > 0 ? (voteCount / totalVotes * 100) : 0;
          const isSelected = option.text === selectedAnswer;
          
          return (
            <div key={index} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white">
                  {isSelected && <CheckCircle className="w-4 h-4" />}
                  <div className="flex items-center gap-2">
                    {option.media_type !== 'none' && option.media_url && (
                      <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-black/20">
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
                    <span className="font-medium">{option.text}</span>
                  </div>
                </div>
                <span className="text-sm text-white font-mono">
                  {getDisplayLabel(voteCount, percentage.toFixed(1))}
                </span>
              </div>
              
              {/* Bar representation */}
              <div className="w-full bg-white/20 rounded-full h-6 overflow-hidden">
                <div 
                  className="h-full transition-all duration-500 ease-out flex items-center px-2"
                  style={{ 
                    width: `${Math.max(percentage, 4)}%`,
                    backgroundColor: getColorForIndex(index)
                  }}
                >
                  {percentage >= 10 && (
                    <span className="text-xs text-white font-medium truncate">
                      {option.text}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PollDisplay;