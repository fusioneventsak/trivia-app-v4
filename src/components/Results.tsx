Here's the fixed version with all missing closing brackets added:

```javascript
                      );
                    })}
                  </div>
                )}
                
                {/* Text Answer Question */}
                {currentActivation.type === 'text_answer' && (
                  <div className="bg-white/20 p-4 rounded-xl">
                    {showAnswers ? (
                      <div className="text-white text-center">
                        <p className="text-lg font-semibold mb-2">Correct Answer:</p>
                        <p className="text-xl">{currentActivation.exact_answer}</p>
                      </div>
                    ) : (
                      <div className="text-white text-center text-lg">
                        Waiting for answers...
                      </div>
                    )}
                  </div>
                )}
                
                {/* Poll */}
                {currentActivation.type === 'poll' && (
                  <div>
                    <PollStateIndicator state={pollState} />
                    <PollDisplay
                      options={currentActivation.options || []}
                      votes={pollVotesByText}
                      totalVotes={totalVotes}
                      displayType={currentActivation.poll_display_type || 'bar'}
                      resultFormat={currentActivation.poll_result_format || 'both'}
                      state={pollState}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-6 mb-6 text-center">
            <PlayCircle className="w-12 h-12 text-white/50 mx-auto mb-4" />
            <p className="text-white text-lg">Waiting for next question...</p>
          </div>
        )}
        
        {/* Player List */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-white" />
              <h2 className="text-lg font-semibold text-white">Players ({players.length})</h2>
            </div>
            <button
              onClick={() => setActivationRefreshCount(prev => prev + 1)}
              className="p-2 text-white/80 hover:text-white rounded-full transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
          
          {players.length > 0 ? (
            <div className="space-y-2">
              {players.map((player) => (
                <LeaderboardItem
                  key={player.id}
                  player={player}
                  rank={playerRankings[player.id]}
                  previousRank={previousRankings[player.id]}
                  showStats={true}
                />
              ))}
            </div>
          ) : (
            <div className="text-center text-white/70 py-8">
              <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No players have joined yet</p>
            </div>
          )}
        </div>
        
        {/* QR Code */}
        <div className="mt-6">
          <QRCodeDisplay url={getJoinUrl()} roomCode={room.room_code} />
        </div>
      </div>
    </div>
  );
}
```